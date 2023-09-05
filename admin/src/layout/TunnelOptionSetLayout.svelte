<script lang="ts">

    import HeaderAppender from "./HeaderAppender.svelte";
    import BodyReplaceAppender from "./BodyReplaceAppender.svelte";
    import type {TunnelingOption, ExternalServerStatus} from "../controller/TunnelingOption";
    import {onMount} from "svelte";
    import ServerOptionCtrl from "../controller/ServerOptionCtrl";
    import ObjectUtil from "../controller/ObjectUtil";
    import AlertLayout from "../component/AlertLayout.svelte";
    import Loading from "../component/Loading.svelte";
    import {type CertInfo, InvalidSession} from "../controller/Types";
    import InputCertFile from "./InputCertFile.svelte";
    import CertificationCtrl from "../controller/CertificationCtrl";

    type TunnelingOptionEx = TunnelingOption & {updatable?: boolean, isSync?: boolean, certInfo?: CertInfo};

    let _externalServerStatuses : {[key: number]: ExternalServerStatus} = {};


    let _tunnelOptions : Array<TunnelingOptionEx> = [];
    let _originTunnelOptions : Array<TunnelingOptionEx> = [];
    let _isInit = false;
    let _loading = false;

    let _showAlert = false;
    let _alertMessage = "";
    let _alertButton = "Ok";

    let _intervalId : NodeJS.Timeout = null;
    let _onCloseAlert = () => {};


    onMount(async ()=> {
        if(_isInit) {
            return;
        }
        await _loadTunnelingOption();
        _startExternalServerStatusUpdate();
        _isInit = true;
    });


    $ : {
        if(_isInit && _tunnelOptions.length > 0) {
            _checkUpdatable();
        }

    }


    let _checkUpdatable = () => {
        for(let tunnelOption of _tunnelOptions) {
            tunnelOption.updatable = ServerOptionCtrl.checkValidTunnelingOption(tunnelOption);
        }

    };


    let _loadTunnelingOption = async () => {
        try {
            _loading = true;
            _tunnelOptions = await ServerOptionCtrl.instance.getTunnelingOption();
            for(let tunnelOption of _tunnelOptions) {
                tunnelOption.isSync = true;
                tunnelOption.updatable = true;
            }
            _originTunnelOptions = ObjectUtil.cloneDeep(_tunnelOptions);
            await _loadCertInfoAll();
            _checkUpdatable();

            _loading = false;
        } catch (e) {
            _loading = false;
            if(e instanceof InvalidSession) {
                _sessionOut();
                return;
            }
            _connectionFail();
        }
    }

    let _loadCertInfoAll = async () => {
        _loading = true;
        for(let port of _tunnelOptions) {
            await _loadCertInfo(port.forwardPort);
        }
        _loading = false;
    }

    let _loadCertInfo = async (port: number) => {
        console.log(port)
        try {
            let tunnelOption : TunnelingOptionEx = _tunnelOptions.find((option) => option.forwardPort === port);
            tunnelOption.certInfo = await CertificationCtrl.instance.loadExternalServerCert(port);
            _tunnelOptions = [..._tunnelOptions];
        } catch (e) {
            console.error(e);

            if(e instanceof InvalidSession) {
                _sessionOut();
                return;
            }
            _connectionFail();
        }
    }

    let _startExternalServerStatusUpdate = () => {
        _loadExternalServerStatus();
        if(!_intervalId) {
            _intervalId = setInterval(async () => {
                if (await _loadExternalServerStatus(true) == false) {
                    clearInterval(_intervalId);
                }
            }, 1000);
        }
    }

    let _loadExternalServerStatus = async (ignoreError?: true) : Promise<boolean> => {
        try {
            let externalServerStatuses : {[port: number] : ExternalServerStatus }= {};
            let statues : Array<ExternalServerStatus>  = await ServerOptionCtrl.instance.loadExternalServerStatus();
            for(let status of statues) {
                externalServerStatuses[status.port] = status;
            }
            _externalServerStatuses = externalServerStatuses;
            return true;
        } catch (e) {
            if(ignoreError) {
                return false;
            }
            if(e instanceof InvalidSession) {
                _sessionOut();
                return false;
            }
            _connectionFail();
            return false;
        }
    }


    let _addEmptyOption = async () => {
        _tunnelOptions.push(
            {
                forwardPort: Math.floor(Math.random() * 65534 +10),
                tls: false,
                protocol: 'tcp',
                httpOption: {
                    rewriteHostInTextBody: true,
                    replaceAccessControlAllowOrigin: false,
                    customRequestHeaders: [],
                    customResponseHeaders: [],
                    bodyRewriteRules: []
                },
                destinationAddress: '127.0.0.1',
                destinationPort: 8080,
                isSync: false,
                updatable: true
            });

        _tunnelOptions = [..._tunnelOptions];



    }



    let _enforceMinMax = (e: KeyboardEvent) => {
        let el = e.target as HTMLInputElement;
        if (el.value != "") {
            if (parseInt(el.value) < parseInt(el.min)) {
                el.value = el.min;
            }
            if (parseInt(el.value) > parseInt(el.max)) {
                el.value = el.max;
            }
        }
    }

    let _onChangeProtocol = (option: TunnelingOption) => {
        if(option.protocol == 'https') {
            let old = option.tls;
            option.tls = true;
            if(!old) _onChangeSecureTunneling(option.forwardPort);
        } else  {
            option.tls = false;
        }
        _tunnelOptions = [..._tunnelOptions];
    }


    let _onClickRemove = async (index: number) => {

        let removeOption = _tunnelOptions[index];
        if(removeOption === undefined) {
            return;
        }
        let tunnelOption = _tunnelOptions[index];
        _loading = true;
        try {
            let result: {success: boolean, message: string, forwardPort: number} = {success: true, message: "", forwardPort: tunnelOption.forwardPort};
            if (tunnelOption.isSync) {
                result = await ServerOptionCtrl.instance.removeTunnelingOption(tunnelOption);
            }
            _loading = false;
            if (result.success) {
                _tunnelOptions.splice(index, 1);
                _tunnelOptions = [..._tunnelOptions];
                if (tunnelOption.isSync) {
                    _alert("Tunneling option has been removed.<br/>The external server has been shut down.");
                }
                await _loadTunnelingOption();
            } else {
                _alert("Fail: " + result.message);
            }
        } catch (e) {
            _loading = false;
            if(e instanceof InvalidSession) {
                _sessionOut();
                return;
            }
            _connectionFail();
        }
    }

    let _removeOldServerPort = async () => {
        let oldPorts = _originTunnelOptions.map((option) => option.forwardPort);
        let newPorts = _tunnelOptions.map((option) => option.forwardPort);
        for(let oldPort of oldPorts) {
            if(newPorts.indexOf(oldPort) === -1) {
                try {
                    let option = _originTunnelOptions.find((option) => option.forwardPort === oldPort);
                    if(option && option.certInfo) {
                        await CertificationCtrl.instance.deleteExternalServerCert(oldPort);
                    }
                    await ServerOptionCtrl.instance.removeTunnelingOption({forwardPort: oldPort});
                } catch (e) {
                    console.error(e);
                }
            }
        }

    }

    let _onClickApply = async (index: number) => {
        _loading = true;
        let tunnelOption = _tunnelOptions[index];
        try {
            await _removeOldServerPort();
            if(tunnelOption.tls) {
                CertificationCtrl
            }

            if(tunnelOption.tls && tunnelOption.certInfo) {
                let result = await CertificationCtrl.instance.updateExternalServerCert(tunnelOption.forwardPort, tunnelOption.certInfo);
                if(!result.success) {
                    _loading = false;
                    _alert("Fail to apply tunneling option: " + result.message);
                    return;
                }
            }
            let result = await ServerOptionCtrl.instance.updateTunnelingOption(tunnelOption);
            _loading = false;
            if (result.success) {
                _originTunnelOptions = ObjectUtil.cloneDeep(_tunnelOptions);
                _alert("Success to apply tunneling option");
            } else {
                _alert("Fail to apply tunneling option: " + result.message);
            }
            await _loadTunnelingOption();
            await _loadExternalServerStatus();
        } catch (e) {
            _loading = false;
            if(e instanceof InvalidSession) {
                _sessionOut();
                return;
            }
            _connectionFail();
        }
    }


    let _connectionFail = () => {
        _alert("Unable to connect to the server.", "OK", () => {
            location.href = "/";
        });
    }

    let _sessionOut = () => {
        _alert("Session is expired.<br/>Please login again.", "OK", () => {
            location.href = "/";
        });
    }


    let _alert = (message: string, button?: string, onClose? : ()=> void) => {
        if(!button) {
            button = "OK";
        } else {
            _alertButton = button;
        }
        if (onClose == null) {
            _onCloseAlert = () => {}
        } else {
            _onCloseAlert = onClose;
        }
        _alertMessage = message;
        _showAlert = true;
    }

    let _onChangeSecureTunneling = async (forwardPort: number) => {
        let option = _tunnelOptions.find((option) => option.forwardPort === forwardPort);
        if(option === undefined) {
            return;
        }
        await _loadCertInfo(forwardPort);

    }

    let _startupTime = (uptime : number) : string => {
        let time = Date.now() - uptime;
        if(time > 1000 * 60 * 60 * 24) {
            return Math.floor(time / (1000 * 60 * 60 * 24)) + "d, " + Math.floor((time % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)) + "h";
        } else if(time > 1000 * 60 * 60) {
            return Math.floor(time / (1000 * 60 * 60)) + "h, " + Math.floor((time % (1000 * 60 * 60)) / (1000 * 60)) + "m";
        } else if(time > 1000 * 60) {
            return Math.floor(time / (1000 * 60)) + "m";
        } else {
            return Math.floor(time / 1000) + "s";
        }
    }

    let _floorPoint = (value: number, point: number) : number => {
        let pow = Math.pow(10, point);
        return Math.floor(value * pow) / pow;
    }

    let _toSize = (bytes: number) : string => {
        bytes = bytes ;
        if(bytes > 1024 * 1024 * 1024) {
            return _floorPoint(bytes / (1024 * 1024 * 1024), 2) + "Gb";
        } else if(bytes > 1024 * 1024) {
            return _floorPoint(bytes / (1024 * 1024), 2) + "Mb";
        } else if(bytes > 1024) {
            return _floorPoint(bytes / 1024,2) + "Kb";
        } else {
            return bytes + "B";
        }

    }



</script>

<main>

    <div class="main-card">
        <div>
            <div style="display: inline-block; margin-bottom: 10px;">
                <h2>
                    Tunneling settings
                </h2>
            </div>
        </div>
        


        {#each _tunnelOptions as option, index}
        <div style="width: 600px;margin-bottom: 20px; ">


            <div style="font-size: 16pt;">
                <div style="display: inline-block; min-width: 25px;font-weight: 900">
                {index + 1}.
                </div>
                <div style="display: inline; color: #444">
                    {option.forwardPort}  ⬌ {option.destinationAddress}:{option.destinationPort} ({option.protocol.toUpperCase()})
                </div>
                <div style="font-size: 18px; font-weight: 400; margin-left: 28px; margin-top: -5px;">
                    {#if _externalServerStatuses[option.forwardPort]}
                        {#if _externalServerStatuses[option.forwardPort].online}
                            <span style="color: darkgreen;">Online</span>
                        {:else }
                            <span style="color: darkred">Error</span>
                        {/if}
                        <span style=" font-size: 10pt;">
                            <span style="font-size: 9pt">({ _startupTime(_externalServerStatuses[option.forwardPort].uptime)}) </span> &nbsp;
                            Sessions: { _externalServerStatuses[option.forwardPort].sessions},
                            &nbsp;
                            RX: { _toSize(_externalServerStatuses[option.forwardPort].rx)},
                            &nbsp;
                            TX: { _toSize(_externalServerStatuses[option.forwardPort].tx)}
                            &nbsp;
                        </span>

                    {:else}
                        <span style="color: gray">Offline</span>
                    {/if}

                </div>
            </div>


            <div  style="display: inline-block;margin-left: 25px; width: calc(100% - 25px);background: #fdfdfd;  border-radius: 5px; padding: 10px;border: 1px solid #bbb; box-shadow: 0 1px 2px rgba(0,0,0,0.1); ">

                <div class="input-box" style="margin-bottom: 0">
                    <label for="input-external-port" class="form-label"  >External Server Port</label>
                    <input type="number" min="0" max="65535" id="input-external-port" class="form-control"  on:keyup={_enforceMinMax} bind:value={option.forwardPort}>
                </div>
                <div class="input-box check-box"  style="margin-bottom: {option.tls ? 10 : 20}px">
                    <input type="checkbox" id="sdf" style="width: 14px;" on:change={()=> {_onChangeSecureTunneling(option.forwardPort) }} bind:checked={option.tls} disabled='{option.protocol !== "tcp"}' >
                    <div style="display: inline-block;position: relative; top: -7px; font-size: 10pt">Secure tunneling Server/Client</div>
                </div>

                {#if option.tls === true}
                   <InputCertFile certInfo={option.certInfo} on:update={(e) => {option.certInfo = e.detail}}  hideMessage={true}></InputCertFile>
                {/if}


                <div class="input-box">
                    <label for="input-destination-host" class="form-label">Destination Host</label>
                    <input type="text" id="input-destination-host" class="form-control" bind:value={option.destinationAddress} >
                </div>

                <div class="input-box">
                    <label for="input-destination-port" class="form-label">Destination Port</label>
                    <input type="number" min="0" max="65535" id="input-destination-port" class="form-control" on:keyup={_enforceMinMax} bind:value={option.destinationPort}>
                </div>

                <div class="input-box" >
                    <label for="select-protocol" class="form-label">Protocol type</label>
                    <select  id="select-protocol" bind:value={option.protocol} on:change={()=>_onChangeProtocol(option)}>
                        <option value="tcp">TCP</option>
                        <option value="http">HTTP (http/1.1)</option>
                        <option value="https">HTTPS (http/1.1)</option>
                    </select>
                </div>


                {#if option.protocol === 'https' || option .protocol === 'http'}
                    <h3>
                        HTTP settings
                    </h3>
                    <div class="http-select-box">
                        <div class="http-select-box-vertical-line"></div>
                        <div class="input-box" >
                            <label for="select-change-host-in-body" class="form-label">Replace Host(address) in text body</label>
                            <select  id="select-change-host-in-body" >
                                <option value="true">Enable</option>
                                <option value="false">Disable</option>
                            </select>
                        </div>

                        <div class="input-box" >
                            <label for="select-change-acao" class="form-label">Replace Access-Control-Allow-Origin header</label>
                            <select  id="select-change-acao" >
                                <option value="true">Enable</option>
                                <option value="false">Disable</option>
                            </select>
                        </div>

                        <div class="input-box">
                            <div  class="form-label">Inject request header</div>
                            <HeaderAppender bind:options={option.httpOption.customRequestHeaders} ></HeaderAppender>
                        </div>
                        <div class="input-box">
                            <div  class="form-label">Inject response header</div>
                            <HeaderAppender bind:options={option.httpOption.customResponseHeaders} ></HeaderAppender>
                        </div>
                        <div class="input-box">
                            <div  class="form-label">Replace text in body</div>
                            <BodyReplaceAppender bind:options={option.httpOption.bodyRewriteRules}></BodyReplaceAppender>
                        </div>
                    </div>

                {/if}

                <div style="margin-bottom: 20px;">
                    <button style="width: 160px" on:click={() => _onClickApply(index)} disabled={!_tunnelOptions[index].updatable} >{_tunnelOptions[index].isSync ? ' Apply and Restart ' : 'Start' }</button>
                    <button style="width: 140px" on:click={() => _onClickRemove(index)}>{_tunnelOptions[index].isSync ? 'Stop and ' : '' }Remove</button>
                </div>
            </div>


        </div>
        {/each}



        <button style="margin-left: {_tunnelOptions.length === 0 ? '0px' : '23px' }; margin-top: 8px; width:  180px" on:click={_addEmptyOption}>Add tunneling service</button>
    </div>

    <AlertLayout bind:show={_showAlert} bind:button={_alertButton} on:close={_onCloseAlert}>
        {@html _alertMessage}
    </AlertLayout>


    <Loading bind:show={_loading}></Loading>




</main>

<style>
    input {
        width: 80%;
        max-width: 320px;
    }


    h3 {
        margin-bottom: 10px;
        margin-top: 0;
    }

    select {
        width: 80%;
        max-width: 325px;
    }


    ul {
        margin-top: 0;
        margin-bottom: 0;
    }

    li {
        margin-left: -10px;
        font-size: 10pt;
        color: #666;

    }


    h2 {
        margin: 0 0 5px 0;
        padding: 0;
        font-size: 20pt;
        color: #333;
    }

    main {
        padding: 10px 10px 0 10px;
        display: block;
    }

    .http-select-box {
        position: relative;
        padding-left: 10px;
        margin-bottom: 20px;
    }

    .http-select-box-vertical-line {
        left: 0;
        width: 2px;
        height: 100%;
        background: #41464b;
        position: absolute;
        top: 0;

    }

    .card {
        text-align: left;
        position: inherit;
        display: inline-block;
        box-sizing: border-box;
        flex-direction: column;
        padding: 15px;
        min-height: 200px;
        width: 100%;
        max-width: 1024px;

        border-radius: 5px;

        border: 1px solid #ccc;

    }



    @media screen and (max-width: 480px) {
        .card {
            width: 95%;
        }
    }
</style>