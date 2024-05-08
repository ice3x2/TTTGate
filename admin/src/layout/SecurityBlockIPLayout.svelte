<script lang="ts">
    import InvalidSession from "../controller/InvalidSession";
    import SecurityCtrl from "../controller/SecurityCtrl";
    import AlertLayout from "../component/AlertLayout.svelte";
    import Loading from "../component/Loading.svelte";
    import {onMount} from "svelte";
    import _ from 'lodash';

    let _listTypeOfIPBlock : 'whitelist' | 'blacklist' = 'whitelist';

    let _showLoading = false;

    let _blacklistOfIPBlock : Array<{ip: string, blocked?: number}> = [];
    let _whitelistOfIPBlock : Array<{ip: string, blocked?: number}> = [];

    let _inputIPEle : HTMLInputElement;

    let _showAlert = false;
    let _alertButton = "OK";
    let _onCloseAlert = () => {}
    let _alertMessage = '';


    onMount(async  () => {
        await _getCountries();
    });


    let _getCountries = async () => {
        _showLoading = true;

        try {
            let ctrl = SecurityCtrl.instance;
            _showLoading = false;
        } catch (e) {
            if (e instanceof InvalidSession) {
                _showLoading = false;
                _sessionOut();
            }
            console.error(e);
        }
    }

    let _sessionOut = () => {
        _alert("Session is expired.<br/>Please login again.", "OK", () => {
            location.href = "/";
        });
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

    let _toLowerButFirst  = (str: string) => {
        return str.split(" ").map((s) => {
            return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        }).join(" ");

    }

    let _getList = () => {
        if (_listTypeOfIPBlock === 'whitelist') {
            return _whitelistOfIPBlock;
        } else {
            return _blacklistOfIPBlock;
        }
    }

    let _checkIPv4 = (ip: string) => {
        let regExp = new RegExp('^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$');
        return regExp.test(ip);
    }

    let _checkIPv6 = (ip: string) => {
        let regExp = new RegExp('^([0-9a-fA-F]{1,4}:){7}([0-9a-fA-F]{1,4})$');
        return regExp.test(ip);
    }

    let _onClickAddIPAddress = () => {
        let ip = _inputIPEle.value;
        if (ip === '') {
            _alert("Please input IP address");
            return;
        }
        if(!_checkIPv4(ip) && !_checkIPv6(ip)) {
            _alert("Invalid IP address");
            return;
        }
        let list = _getList();

        let alreadyItem = list.find((item) => item.ip === ip);
        let blocked = 0;
        console.log(alreadyItem);
        if(alreadyItem) {
            blocked = alreadyItem.blocked ?? 0;
            _.remove(list, (item) => item.ip === ip);
        }
        list.push({ip: ip, blocked: blocked});
        if (_listTypeOfIPBlock === 'whitelist') {
            _whitelistOfIPBlock = list;
        } else {
            _blacklistOfIPBlock = list;
        }
    }

    let _onClickClearIPAddresses = () => {
        if (_listTypeOfIPBlock === 'whitelist') {
            _whitelistOfIPBlock = [];
        } else {
            _blacklistOfIPBlock = [];
        }
    }


    let _onClickRemoveIP = (e: MouseEvent, index: number) => {
        let list = _getList();
        list.splice(index, 1);
        if (_listTypeOfIPBlock === 'whitelist') {
            _whitelistOfIPBlock = list;
        } else {
            _blacklistOfIPBlock = list;
        }
    }

</script>

<main>

    <div class="round-box">

        <h3 style="margin-top: 0px; margin-bottom: 10px">
        Block IP Access
        </h3>
        <div style="display: flex; align-items: center;">
            <span class="form-label">Block access</span>
            <input type="radio" bind:group={_listTypeOfIPBlock} value="blacklist" style="width: 20px; margin: 0 10px 0 5px">
            <span class="form-label">Allow access</span>
            <input type="radio" bind:group={_listTypeOfIPBlock} value="whitelist" style="width: 20px; margin: 0 10px 0 5px">
        </div>


        <div style="margin-top: 10px">
            <input bind:this={_inputIPEle} type="text" style="width: calc(100% - 70px)"> <button on:click={_onClickAddIPAddress} style="width: 45px; margin-left: 10px">Add</button>
        </div>

        <div style="margin-top: 10px; font-size: 10pt">
            {#if _listTypeOfIPBlock === 'whitelist'}
                White list
            {:else}
                Black list
            {/if}
        </div>
        <div style="border: #ccc solid 1px; width: 100%; border-radius: 5px;">
            {#each (_listTypeOfIPBlock === 'whitelist' ? _whitelistOfIPBlock : _blacklistOfIPBlock)  as item, index}
                <div style="position: relative; color: #444; padding: 0 5px 0 5px;display: flex; align-items: center; height: 28px;  {_getList().length -1 === index ? '' : 'border-bottom: #ccc solid 1px;'} ">
                    <span style="font-size: 8pt">{item.ip}</span>
                    <span style="font-size: 8pt; margin-left: 5px">({item.blocked ? item.blocked  : 0})</span>
                    <button style="position: absolute; right: 10px; height: 20px; font-size: 6pt" on:click={(e)=>{_onClickRemoveIP(e, index)}}>X</button>
                </div>
            {/each}
            {#if (_listTypeOfIPBlock === 'whitelist' ? _whitelistOfIPBlock : _blacklistOfIPBlock).length === 0}
                <div style="color: #444; padding: 0 5px 0 5px;display: flex; align-items: center; height: 28px;">
                    <span style="font-size: 8pt">No IP address</span>
                </div>
            {/if}
        </div>
        <div style="display: flex; position: relative; width: 100%; margin-top: 10px">
            <button on:click={(e)=> {_onClickClearIPAddresses()}}>Clear</button>
            <button style="right: 0; position: absolute">Apply</button>
        </div>




    </div>



    <Loading bind:show={_showLoading}></Loading>
    <AlertLayout bind:show={_showAlert} bind:button={_alertButton} on:close={_onCloseAlert}>
        {@html _alertMessage}
    </AlertLayout>





</main>

<style>
    main {
        margin-top: 10px;
        display: block;
    }
</style>