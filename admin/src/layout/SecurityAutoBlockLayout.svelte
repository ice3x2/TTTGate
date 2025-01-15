<script lang="ts">
    import InvalidSession from "../controller/InvalidSession";
    import SecurityCtrl from "../controller/SecurityCtrl";
    import AlertLayout from "../component/AlertLayout.svelte";
    import Loading from "../component/Loading.svelte";
    import {onMount} from "svelte";
    import SecurityBlockCountryLayout from "./SecurityBlockCountryLayout.svelte";
    import SecurityBlockIPLayout from "./SecurityBlockIPLayout.svelte";

    let _showLoading = false;

    let _autoBlacklistOfIPBlock : Array<{ip: string, blocked?: number}> = [];


    let _showAlert = false;
    let _alertButton = "OK";
    let _onCloseAlert = () => {}
    let _alertMessage = '';


    onMount(async  () => {

    });



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

    let _onClickRemoveIP = (e: MouseEvent, index: number) => {
        _autoBlacklistOfIPBlock.splice(index, 1);
    }


</script>

<main>
    <div class="round-box">
        <h3 style="margin-top: 0px; margin-bottom: 10px">
        Auto-Block frequent connections option
        </h3>
        <div>Blocks when <input type="number" style="width: 50px; margin: 0 6px 0 6px">connection attempts <span> occur&nbsp;&nbsp;<input type="number" style="width: 50px">ms</span></div>

        <div style="margin-top: 10px; font-size: 10pt">
            Automatically blocked IP list
        </div>
        <div style="border: #ccc solid 1px; width: 100%; border-radius: 5px;">
            {#each _autoBlacklistOfIPBlock  as item, index}
                <div style="position: relative; color: #444; padding: 0 5px 0 5px;display: flex; align-items: center; height: 28px;  {_autoBlacklistOfIPBlock.length -1 === index ? '' : 'border-bottom: #ccc solid 1px;'} ">
                    <span style="font-size: 8pt">{item.ip}</span>
                    <span style="font-size: 8pt; margin-left: 5px">({item.blocked ? item.blocked  : 0})</span>
                    <button style="position: absolute; right: 10px; height: 20px; font-size: 6pt" on:click={(e)=>{_onClickRemoveIP(e, index)}}>X</button>
                </div>
            {/each}
            {#if _autoBlacklistOfIPBlock.length === 0}
                <div style="color: #444; padding: 0 5px 0 5px;display: flex; align-items: center; height: 28px;">
                    <span style="font-size: 8pt">No IP address</span>
                </div>
            {/if}
        </div>
        <div style="display: flex; position: relative;height: 30px; width: 100%; margin-top: 10px">
            <button style="right: 0; position: absolute">Apply</button>
        </div>

    </div>





    <Loading bind:show={_showLoading}></Loading>
    <AlertLayout bind:show={_showAlert} bind:button={_alertButton} on:close={_onCloseAlert}>
        {@html _alertMessage}
    </AlertLayout>





</main>

<style>
    main {;
        margin-top: 10px;

        display: block;
    }
</style>