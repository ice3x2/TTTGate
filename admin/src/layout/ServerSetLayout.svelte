<script lang="ts">

    import ServerOptionCtrl from "../controller/ServerOptionCtrl";
    import CertificationCtrl from "../controller/CertificationCtrl";
    import {type CertInfo,type ServerOption, InvalidSession} from "../controller/Types";
    import {onMount} from "svelte";
    import InputCertFile from "./InputCertFile.svelte";
    import Loading from "../component/Loading.svelte";
    import AlertLayout from "../component/AlertLayout.svelte";
    import ObjectUtil from "../controller/ObjectUtil";

    let _serverOption : ServerOption = ServerOptionCtrl.instance.getCachedServerOption();
    let _lastServerOption : ServerOption = ServerOptionCtrl.instance.getCachedServerOption();
    let _adminServerCert : CertInfo | null = null;
    let _originalAdminCert : CertInfo | null = null;
    let _lastAdminCert : CertInfo | null = null;
    let _isInit: boolean = false;

    let _showLoading: boolean = false;

    let _showAlert = false;
    let _alertButton = "OK";
    let _onCloseAlert = () => {}
    let _alertMessage = '';
    let _isNewValue = false;

    onMount(async () => {
        if (_isInit) {
            return;
        }
        try {
            _showLoading = true;
            _serverOption = await ServerOptionCtrl.instance.getServerOption();
            await ServerOptionCtrl.instance.getServerOptionHash();
            _lastServerOption = ObjectUtil.cloneDeep(_serverOption);
            _adminServerCert = await CertificationCtrl.instance.loadAdminCert();
            _lastAdminCert = ObjectUtil.cloneDeep(_adminServerCert);
            _originalAdminCert = ObjectUtil.cloneDeep(_adminServerCert);
            _isInit = true;
            _showLoading = false;
        } catch (e) {
            console.error(e)
            if(e instanceof InvalidSession) {
                _sessionOut();
                return;
            }
            _alert("Unable to connect to the server.", "OK", () => {
                location.href = "/";
            });
        }
    });

    $ : {
        _isNewValue = !ObjectUtil.equalsDeep(_serverOption, _lastServerOption) || ((_adminServerCert == null || _lastAdminCert == null) || !ObjectUtil.equalsDeep(_adminServerCert, _lastAdminCert));
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

    let _onUpdateAdminCert = (e: CustomEvent) => {
        _updateAdminCert(e.detail);
    }

    let _updateAdminCert = async (newAdminCert : CertInfo) => {
        _showLoading = true;

        try {
            let result = await CertificationCtrl.instance.updateAdminCert(newAdminCert);
            if (result.success) {
                _lastAdminCert = _adminServerCert;
                _adminServerCert = newAdminCert;
            } else {
                _alert(result.message);
            }
            _showLoading = false;
        } catch (e) {
            console.error(e);
            if (e instanceof InvalidSession) {
                _showLoading = false;
                _sessionOut();
            } else {
                _alert("Unable to connect to the server.", "Retry", async () => {
                    await _updateAdminCert(newAdminCert);
                });
            }
        }
    }

    let _alert = (message: string, button?: string, onClose? : ()=> void) => {
        if(button == null) {
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


    let _apply = async () => {
        try {
            _showLoading = true;
            let result = await ServerOptionCtrl.instance.updateServerOption(_serverOption);
            _showLoading = false;
            if (result.success) {
                await _checkServerRestart();
            } else {
                _alert(result.message);
            }
        } catch (e) {
            console.error(e);
            _showLoading = false;
            if (e instanceof InvalidSession) {
                _sessionOut();
            } else {
                _alert("Unable to connect to the server.", "Retry", async () => {
                    await _apply();
                });
            }
        }
    }

    let _checkServerRestart = async () => {
        _showLoading = true;
        let success = false;
        try {
            success = await ServerOptionCtrl.instance.checkChangeServerOption(_lastServerOption, _serverOption);
        } catch (e) {
            _alert(`Error: Server status could not be determined.${_serverOption.adminTls ? '(It could be a TSL certificate error.)' : ''}`, 'OK', () => {
                console.log((_serverOption.adminTls ? "https://" : "http://") + location.hostname + ':' + _serverOption.adminPort + '/');
                location.href = (_serverOption.adminTls ? "https://" : "http://") + location.hostname + ':' + _serverOption.adminPort + '/';
            });
            return;
        }
        _showLoading = false;
        if(success) {
            _alert("Server settings have been changed.<br/>The server has been restarted.", 'OK', () => {
                _lastServerOption = ObjectUtil.cloneDeep(_serverOption);
                _lastAdminCert = ObjectUtil.cloneDeep(_adminServerCert);
                _originalAdminCert = ObjectUtil.cloneDeep(_adminServerCert);
                console.log((_serverOption.adminTls ? "https://" : "http://") + location.hostname + ':' + _serverOption.adminPort + '/');
                location.href = (_serverOption.adminTls ? "https://" : "http://") + location.hostname + ':' + _serverOption.adminPort + '/';
            });
        } else {
            _alert("New server options cannot be applied.", 'OK', () => {
                _serverOption  = ObjectUtil.cloneDeep(_lastServerOption);
                _adminServerCert = ObjectUtil.cloneDeep(_originalAdminCert);
                _lastAdminCert = ObjectUtil.cloneDeep(_adminServerCert);
                location.href = '/';
            });
        }

    }

    let _reset = () => {
        let isChangedCert = !ObjectUtil.equalsDeep(_adminServerCert, _originalAdminCert);
        _serverOption = ObjectUtil.cloneDeep(_lastServerOption);
        _adminServerCert = ObjectUtil.cloneDeep(_originalAdminCert);
        if (isChangedCert) {
            _updateAdminCert(_adminServerCert);
        }
    }


    let _sessionOut = () => {
        _alert("Session is expired.<br/>Please login again.", "OK", () => {
            location.href = "/";
        });
    }


</script>

<main>

    <h2 class="title">
        Server settings
    </h2>
    <div class="round-box">
        <div class="input-box">
            <label for="input-key" class="form-label">Tunnel server-client authentication key</label>
            <input type="text" id="input-key" class="form-control" aria-describedby="passwordHelpBlock" bind:value={_serverOption.key}>
        </div>
        <div class="input-box" style="margin-bottom: 5px">
            <label for="input-admin-port" class="form-label">Admin service port number</label>
            <input type="number" min="0" max="65535" id="input-admin-port" class="form-control"
                   aria-describedby="passwordHelpBlock" on:keyup={_enforceMinMax} bind:value={_serverOption.adminPort}>
        </div>
        <div class="check-box"  style="margin-bottom: {_serverOption.adminTls ? 10 : 20}px">
            <input type="checkbox" style="width: 14px" bind:checked={_serverOption.adminTls} >
            <div style="display: inline-block;position: relative; top: -7px; font-size: 10pt">Secure tunneling Server/Client</div>
        </div>


        {#if _serverOption.adminTls}
            <InputCertFile certInfo={_adminServerCert} on:update={_onUpdateAdminCert} ></InputCertFile>
        {/if}


        <div class="input-box" style="margin-bottom: 5px; margin-top: 20px">
            <label for="input-tunnel-port" class="form-label">Tunnel server port number</label>
            <input type="number" min="0" max="65535" id="input-tunnel-port" class="form-control" on:keyup={_enforceMinMax} bind:value={_serverOption.port}>
        </div>
        <div class="check-box" style="margin-bottom: 25px">
            <input type="checkbox" style="width: 14px" bind:checked={_serverOption.tls}>
            <div style="display: inline-block;position: relative; top: -7px; font-size: 10pt">Enable secure Tunnel server</div>
        </div>

        <div class="input-box">
            <label for="input-global-cache-limit" class="form-label" >Total buffer size limit (MiB) </label>
            <input type="number" min="1" max="99999" on:keyup={_enforceMinMax}  bind:value={_serverOption.globalMemCacheLimit}>
        </div>

        <div style="width: 100%; margin-top: 40px">
            <div style="display: inline-block">
                <button style="width: 100px" disabled={!_isNewValue} on:click={_apply}>Apply</button>
            </div>
            <div style="display: inline-block">
                <button style="width: 100px" on:click={_reset}>Reset</button>
            </div>
        </div>


    </div>

    <Loading bind:show={_showLoading}></Loading>
    <AlertLayout bind:show={_showAlert} bind:button={_alertButton} on:close={_onCloseAlert}>
        {@html _alertMessage}
    </AlertLayout>

</main>

<style>
    input {
        width: calc(100% - 10px);
    }



    main {
        padding: 10px 10px 0 10px;
        display: block;
    }

</style>