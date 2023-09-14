<script lang="ts">

    import HeaderAppender from "./HeaderAppender.svelte";
    import BodyReplaceAppender from "./BodyReplaceAppender.svelte";
    import type {Options, TunnelingStatus} from "../controller/Options";
    import {onMount} from "svelte";
    import ServerOptionCtrl from "../controller/ServerOptionCtrl";
    import ObjectUtil from "../controller/ObjectUtil";
    import AlertLayout from "../component/AlertLayout.svelte";
    import Loading from "../component/Loading.svelte";
    import {type CertInfo, InvalidSession} from "../controller/Types";
    import InputCertFile from "./InputCertFile.svelte";
    import CertificationCtrl from "../controller/CertificationCtrl";
    import Switch from "../component/Switch.svelte";
    import Timer from "./Timer.svelte";
    import {assignWith} from "lodash";

    type Timers = {
        [key: number]: Timer
    }

    type TunnelingOptionEx = Options & {updatable?: boolean, isSync?: boolean, certInfo?: CertInfo, allowedClientNamesQuery?: string, activeTimeout?: number};

    let _externalServerStatuses : {[key: number]: TunnelingStatus} = {};

    let _serverTime : number = 0;
    let _tunnelOptions : Array<TunnelingOptionEx> = [];
    let _originTunnelOptions : Array<TunnelingOptionEx> = [];
    let _isInit = false;
    let _loading = false;
    let _transitionLoading = false;


    let _showAlert = false;
    let _alertMessage = "";
    let _alertButton = "Ok";

    let _timerElements : Timers = {};


    let _intervalId : NodeJS.Timeout = null;
    let _onCloseAlert = () => {};


    onMount(async ()=> {
        if(_isInit) {
            return;
        }
        await _loadTunnelingOption();
        await _loadExternalServerStatus();
        _startExternalServerStatusUpdate();
        _isInit = true;
    });


    $ : {
        if(_isInit && _tunnelOptions.length > 0) {
            _checkUpdatable();
        }
        for(let option of _tunnelOptions) {
            option.destinationPort = _normalizePortNumber(option.destinationPort);
            option.forwardPort = _normalizePortNumber(option.forwardPort);
            option.bufferLimitOnClient = _normalizeMemBufferSize(option.bufferLimitOnClient);
            option.bufferLimitOnServer = _normalizeMemBufferSize(option.bufferLimitOnServer);
        }
    }

    let _normalizePortNumber = (port: number) => {
        if(port < 0) {
            return 0;
        } else if(port > 65535) {
            return 65535;
        } else {
            return port;
        }
    }

    let _normalizeMemBufferSize = (size: number) => {
        if(size < -1) {
            return -1;
        } else if(size > 1048576) {
            return 1048576;
        } else {
            return size;
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
                tunnelOption.allowedClientNamesQuery = tunnelOption.allowedClientNames?.join("; ");
                if(!tunnelOption.allowedClientNamesQuery) tunnelOption.allowedClientNamesQuery = "";
                else tunnelOption.allowedClientNamesQuery += ";";
            }
            _originTunnelOptions = ObjectUtil.cloneDeep(_tunnelOptions);

            await _loadCertInfoAll();
            _checkUpdatable();

            _loading = false;
        } catch (e) {
            console.error(e);
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
                if (_loading) return;
                if (await _loadExternalServerStatus(true) == false) {
                    clearInterval(_intervalId);
                }
            }, 1000);
        }
    }

    let _loadExternalServerStatus = async (ignoreError?: true) : Promise<boolean> => {
        try {
            let externalServerStatuses : {[port: number] : TunnelingStatus }= {};
            let result : {serverTime: number,statuses: Array<TunnelingStatus>}  = await ServerOptionCtrl.instance.loadTunnelingStatus();
            _serverTime = result.serverTime;
            for(let status of result.statuses) {
                externalServerStatuses[status.port] = status;
                if(status && status.active) {
                    if(_timerElements[status.port]) {
                        _timerElements[status.port].update(_getTimeout(status), status.activeTimeout);
                    }
                }
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
                updatable: true,
                allowedClientNamesQuery: ""

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

    let _onChangeProtocol = (option: Options) => {
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
        tunnelOption.allowedClientNames = tunnelOption.allowedClientNamesQuery.split(";").map((name) => name.trim()).filter((name) => name !== "");
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

                if(_timerElements[tunnelOption.forwardPort] && _externalServerStatuses[tunnelOption.forwardPort]?.activeTimeout) {
                    _timerElements[tunnelOption.forwardPort].reset(_externalServerStatuses[tunnelOption.forwardPort].activeTimeout);
                }
                _originTunnelOptions = ObjectUtil.cloneDeep(_tunnelOptions);
                _alert("Success to apply tunneling option");
            } else {
                _alert("Fail to apply tunneling option: " + result.message);
            }
            await _loadTunnelingOption();
            await _loadExternalServerStatus();
        } catch (e) {
            console.error(e);
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
        if(!uptime) {
            return "0s";
        }

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

    let _getTimeout = (status : TunnelingStatus ) : number => {
        let timeout = status.activeStart + (status.activeTimeout * 1000) - _serverTime;
        if(timeout < 0) {
            timeout = 0;
        }
        timeout = Math.floor(timeout / 1000);
        return timeout;

    }

    let _onChangeActive = async (active: boolean, port: number, time? : number) => {


        if(active) {
            let status = _externalServerStatuses[port];
            if (status && _timerElements[status.port]) {
                _timerElements[status.port].update(_getTimeout(status), status.activeTimeout);
            }
        }


        let oldActive = _externalServerStatuses[port].active;
        if(oldActive == active && time == undefined) {
            console.log('time: ' + time)
            return;
        }
        time = time ?? _externalServerStatuses[port].activeTimeout;
        try {
            _loading = true;
            _transitionLoading = true;
            let result = await ServerOptionCtrl.instance.activeExternalPortServer(active,port,time);
            await _loadExternalServerStatus();
            if (result.success) {
                _externalServerStatuses[port].active = active;
            } else {
                _externalServerStatuses[port].active = oldActive;
            }
            if(time > 0) {

            }

            _loading = false;
            _transitionLoading = false;
        } catch (e) {
            console.error(e);
            _loading = false;
            _transitionLoading = false;
            if(e instanceof InvalidSession) {
                _sessionOut();
                return;
            }
            _connectionFail();
        }

    }




</script>

<main>

    <div class="">
        <div>
            <div style="display: inline-block; margin-top: 20px; margin-bottom: 10px;">
                <h2>
                    Tunneling settings
                </h2>
            </div>
        </div>
        


        {#each _tunnelOptions as option, index}
        <div style="width: 100%;margin-bottom: 20px; ">


            <div style="font-size: 16pt;">

                <div style="display: block">
                    <div class="tunneling-title" style="display: inline; min-width: 25px;font-weight: 900">
                    {index + 1}.
                    </div>
                    <div class="tunneling-title" style="display: inline; color: #444">
                        {option.forwardPort}  ⬌ {option.destinationAddress}:{option.destinationPort} ({option.protocol.toUpperCase()})
                    </div>
                </div>



                <div class="round-box" style="margin-bottom: 5px">
                    <div style="font-size: 18pt; font-weight: 400; margin-top: -5px; display: inline-block">
                        {#if _externalServerStatuses[option.forwardPort]}
                            {#if _externalServerStatuses[option.forwardPort].online}
                                <span style="color: darkgreen;">Online</span>
                            {:else }
                                <span style="color: darkred">Error</span>
                            {/if}
                            <span class="sub-status">
                                Uptime: { _startupTime(_externalServerStatuses[option.forwardPort].uptime)},
                                &nbsp;
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


                    {#if _externalServerStatuses[option.forwardPort]?.online}
                        <div style="display:  block; position: relative; height: 34px; min-width: 370px">
                            <span class="status-label" >Activation:</span>
                            <div style="display: inline; position: relative;">
                                <Switch on={_externalServerStatuses[option.forwardPort]?.active} on:change={(e) => _onChangeActive(e.detail.on, option.forwardPort)} style="position: absolute; margin-left: 5px; margin-top: 3px"></Switch>
                            </div>
                            {#if _externalServerStatuses[option.forwardPort] && _externalServerStatuses[option.forwardPort].active}
                                <div class="status-label" style="display: inline-block; margin-left: 65px">Timeout:</div>
                                <div style="display: inline">
                                <Timer bind:this={_timerElements[option.forwardPort]}
                                       on:change={(e) => { _onChangeActive(true, option.forwardPort, e.detail.time)}}
                                       style="position: absolute; margin-left: 5px; margin-top: 3px"></Timer>
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>

            </div>

            <div  class="round-box">


                <div class="input-box" style="margin-bottom: 0">
                    <label for="input-external-port" class="form-label"  >External Server Port</label>
                    <input type="number" id="input-external-port" class="form-control"  bind:value={option.forwardPort}>
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
                    <input type="number" id="input-destination-port" class="form-control" bind:value={option.destinationPort}>
                </div>

                <div class="input-box">
                    <label for="input-allow-client-names" class="form-label">Allowed Client names <span style="font-size: 8pt">(Separate names with a semicolon(;))</span></label>
                    <input type="text"  id="input-allow-client-names" class="form-control" bind:value={option.allowedClientNamesQuery}>
                </div>

                <!--
                <div class="input-box" >
                    <label for="select-buffer-options-server" class="form-label">Buffer options (server)</label>
                    <select  id="select-buffer-options-server"  style="min-width: calc(100% - 5px)" >
                        <option value="0">Unlimited buffer size</option>
                        <option value="1">Buffer size limit</option>
                        <option value="2">File cache when buffer limit reached</option>
                    </select>
                </div>-->

                <div class="input-box">
                    <div class="form-label">Mem Buffer size limit per Sessions (MiB)</div>

                    <div style="width: calc(50% - 2px); display: inline-block;">
                        <label for="input-buffer-limit-server" class="form-label" style="font-size: 10pt;color: #666666; " >Server</label>
                        <input type="number" id="input-buffer-limit-server" class="form-control"  bind:value="{option.bufferLimitOnServer}">
                    </div>
                    <div style="width: calc(50% - 2px); display: inline-block;">
                        <label for="input-buffer-limit-client" class="form-label" style="font-size: 10pt;color: #666666; ">Client</label>
                        <input type="number" id="input-buffer-limit-client" class="form-control"  bind:value="{option.bufferLimitOnClient}">
                    </div>
                    <div style="color: #666;font-size: 10pt;margin-left: -10px">
                        <ul>
                            <li><span style="font-weight: 900">-1</span> : Unlimited memory buffer.</li>
                            <li><span style="font-weight: 900">0</span> : Only file cache is used.</li>
                            <li><span style="font-weight: 900">0&lt;n</span> : When memory buffer limit is exceeded, it uses file cache.</li>
                        </ul>
                    </div>
                </div>



                <div class="input-box" >
                    <label for="select-protocol" class="form-label">Protocol type</label>
                    <select  id="select-protocol"  style="min-width: calc(100% - 5px)" bind:value={option.protocol} on:change={()=>_onChangeProtocol(option)}>
                        <option value="tcp">TCP</option>
                        <option value="http">HTTP (http/1.1)</option>
                        <option value="https">HTTPS (http/1.1)</option>
                    </select>
                </div>


                {#if option.protocol === 'https' || option .protocol === 'http'}
                    <h3>
                        HTTP Options
                    </h3>
                    <div class="http-select-box">
                        <div class="http-select-box-vertical-line"></div>
                        <div class="input-box" >
                            <label for="select-change-host-in-body" class="form-label">Replace Host(address) in text body</label>
                            <select  id="select-change-host-in-body" >
                                <option value="true">Enabled</option>
                                <option value="false">Disabled</option>
                            </select>
                        </div>

                        <div class="input-box" >
                            <label for="select-change-acao" class="form-label">Replace Access-Control-Allow-Origin header</label>
                            <select  id="select-change-acao" >
                                <option value="true">Enabled</option>
                                <option value="false">Disabled</option>
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
                <div>
                    <input type="checkbox"  style="width: 14px;" on:change={()=> { }} bind:checked={option.inactiveOnStartup}  >
                    <div style="display: inline-block;position: relative; top: -7px; font-size: 10pt">Inactive on startup</div>
                </div>



                <div >
                    <button style="width: 160px" on:click={() => _onClickApply(index)} disabled={!_tunnelOptions[index].updatable} >{_tunnelOptions[index].isSync ? ' Apply and Restart ' : 'Start' }</button>
                    <button style="width: 140px" on:click={() => _onClickRemove(index)}>{_tunnelOptions[index].isSync ? 'Stop and ' : '' }Remove</button>
                </div>
            </div>


        </div>
        {/each}



        <button style="margin-top: 8px; width:  180px" on:click={_addEmptyOption}>Add tunneling service</button>
    </div>

    <AlertLayout bind:show={_showAlert} bind:button={_alertButton} on:close={_onCloseAlert}>
        {@html _alertMessage}
    </AlertLayout>


    <Loading bind:show={_loading} bind:transition={_transitionLoading}></Loading>




</main>

<style>



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

    .tunneling-title {
        font-size: 16pt;
        font-weight: 800;
        display: inline-block;
    }

    .sub-status {
        font-size: 11pt;
    }

    .status-label {
        font-size: 15pt;
    }

    @media screen and (max-width: 480px) {
        .tunneling-title {
            font-size: 12pt;

        }
        .sub-status {
            font-size: 8pt;
        }

        .status-label {
            font-size: 11pt;
        }
    }
</style>