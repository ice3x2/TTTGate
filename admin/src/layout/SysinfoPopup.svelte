<script lang="ts">
    import {createEventDispatcher} from "svelte";
    import type {SysInfo, NetworkInfo, NetworkInterface} from "../controller/Types";
    import ExMath from "../controller/ExMath";


    export let show = false;
    export let button = 'Ok';

    export let sysInfo : SysInfo | undefined = undefined;

    const dispatch = createEventDispatcher();

    let _onClose = () => {
        dispatch("close");
        setTimeout(() => {
            show = false;
        },0);
    }


    let _byteToUnit = (length: number,hideUnit?: boolean) : string => {
        const tib = 1024 * 1024 * 1024 * 1024;
        const gib = 1024 * 1024 * 1024;
        const mib = 1024 * 1024;
        const kib = 1024;
        if(length > tib) {
            return `${ExMath.round(length / tib, 1)}${hideUnit? '':'TiB'}`;
        } else if(length > gib) {
            return `${ExMath.round(length / gib, 1)}${hideUnit? '':'GiB'}`;
        } else if(length > mib) {
            return `${ExMath.round(length / mib, 1)}${hideUnit? '':'MiB'}`;
        } else if(length > kib) {
            return `${ExMath.round(length / kib, 1)}${hideUnit?'': 'KiB'}`;
        } else {
            return `${length}${hideUnit? '':'B'}`;
        }
    }

</script>
<main style="display: {!show ? 'none' : 'flex'};">
    <div class="background"></div>
    <div class="popup-box">
        <div class="content-box" >
            <div style="height: 100%; width: 100%; overflow-y: auto; overflow-x: hidden;">
                {#if sysInfo}

                    <h4>HW Info</h4>
                    <ul>
                        <li>CPU: {sysInfo.cpuInfo.model}</li>
                        <li>Clock: {sysInfo.cpuInfo.speed}</li>
                        <li>Cores: {sysInfo.cpuInfo.cores}</li>
                        <li>RAM: {_byteToUnit(sysInfo.ram)}</li>
                    </ul>

                    <h4>OS Info</h4>
                    <ul>
                        <li>Type: {sysInfo.osInfo.type}</li>
                        <li>Platform: {sysInfo.osInfo.platform}</li>
                        <li>Release: {sysInfo.osInfo.release}</li>
                        <li>hostname: {sysInfo.osInfo.hostname}</li>
                    </ul>

                    <h4>Network</h4>
                    <ul>
                    {#each Object.keys(sysInfo.network) as interfaceName}
                        <li style="margin-top: 10px">{interfaceName}:</li>
                        {#each sysInfo.network[interfaceName] as network}
                        <ul>
                            <li>address: {network.address}</li>
                            <li>netmask: {network.netmask}</li>
                            <li>mac: {network.mac}</li>
                            <li>internal: {network.internal}</li>
                            <li>family: {network.family}</li>
                            <li>cidr: {network.cidr}</li>
                        </ul>
                        {/each}
                    {/each}
                    </ul>


                {/if}
            </div>
        </div>
        <div style="width: 100%; display: flex; justify-content: center; align-items: center;"><button style="width: 150px" on:click={_onClose}>{button}</button></div>

    </div>

</main>
<style>

    ul {
        margin-top: 5px;
    }
    h4 {
        margin-top: 15px;
        margin-bottom: 0;
        padding-bottom: 0;
    }

    main {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    }

    .content-box {
        justify-content: center;
        width: 100%;
        height: calc(100% - 40px);
    }


    .popup-box {
        padding: 5px;

        left: 0;
        background: white;
        border-radius: 5px;
        border: 1px solid #808080;
        box-shadow: 0 1px 20px rgba(0, 0, 0, 0.5);
        z-index: 1001;
        height: 80%;
        width: 90%;
        max-width: 480px;
    }

    .background {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1000;
        background: black;
        opacity: 0.3;

    }
</style>