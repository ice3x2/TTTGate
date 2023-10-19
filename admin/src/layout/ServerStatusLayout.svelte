<script lang="ts">
import Gauge from "../component/Gauge.svelte";
import ServerStatusCtrl from "../controller/ServerStatusCtrl";
import CpuIcon from "../assets/cpu.png";
import UptimeIcon from "../assets/uptime.png";

import {InvalidSession, type ClientStatus, type SysInfo, type Usage, type NetworkInfo} from "../controller/Types";
import AlertLayout from "../component/AlertLayout.svelte";
import {onMount} from "svelte";
import ExMath from "../controller/ExMath";
import SysinfoPopup from "./SysinfoPopup.svelte";

let _showSysInfo = false;
let _showAlert = false;
let _alertMessage = "";
let _alertButton = "Ok";
let _intervalId : any;


let _onCloseAlert = () => {};

let _sysInfo : SysInfo;
let _usage : Usage = undefined;
let _clientStatuses : Array<ClientStatus> = [];
ServerStatusCtrl.getVersion()
onMount(async () => {
    if(!_intervalId) {

        _startStatusUpdate();
    }
    if(!_sysInfo) {
        _sysInfo = await ServerStatusCtrl.instance.getSysInfo();
    }
})
let _startStatusUpdate = () => {
    _loadServerStatus();
    if(!_intervalId) {
        _intervalId = setInterval(async () => {
            if (await _loadServerStatus() == false) {
                clearInterval(_intervalId);
            }
        }, 1000);
    }
}

let _loadServerStatus = async () : Promise<boolean> => {
    try {
        _usage = await ServerStatusCtrl.instance.getSysUsage();
        _clientStatuses = await ServerStatusCtrl.instance.getClientStatus();
        return true;
    } catch (e) {
        if (e instanceof InvalidSession) {
            _sessionOut();

        }
    }
    return false;
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

let onClickShowInfo = (e: Event) => {
    _showSysInfo = true;
}

let _timeToDMH =(time: number) => {
    time = time / 1000;
    const day = Math.floor(time / (24 * 60 * 60));
    const hour = Math.floor((time % (24 * 60 * 60)) / (60 * 60));
    const min = Math.floor((time % (60 * 60)) / 60);
    const sec = Math.floor(time % 60);
    return `${day}d ${hour}h ${min}m ${sec}s`;
}

</script>

<main>
    <h2 class="title">
        Status
    </h2>
    <div class="round-box">
        <div>
            <div style="display: inline-block">
                <div style="display: flex; align-items: center; cursor: pointer; margin-bottom: 5px" on:click={onClickShowInfo}>
                    <img src={CpuIcon} width="16" height="16" alt="info">
                    <span style="margin-left: 2px; font-size: 10pt; text-decoration: underline;color: #555;">INFO</span>
                </div>
            </div>

            {#if _usage !== undefined}
            <div style="display: inline-block; margin-left: 10px">
                <div style="display: flex; align-items: center; margin-bottom: 5px">
                    <img src={UptimeIcon} width="16" height="16" alt="info">
                    <span style="margin-left: 2px; font-size: 10pt;color: #555;">{_timeToDMH(_usage.uptime)}</span>
                </div>
            </div>
            {/if}
        </div>


        {#if _usage !== undefined}
            <div class="gauge-box">
                <Gauge style="" title="CPU" message="{`${ _usage.cpu.process}/${_usage.cpu.total}%`}" value={_usage.cpu.process} duration={900}></Gauge>
            </div>
            <div class="gauge-box">
                <Gauge style=""   title="Memory"  message={`${_byteToUnit(_usage.memory.process)}/${_byteToUnit(_usage.memory.total)}`}  value={_usage.memory.process} max={_usage.memory.total} duration={900}/>
              <!--  <div  class="status-value-box">{_byteToUnit(_memoryUsage.process)}/{_byteToUnit(_memoryUsage.total)}</div>-->
            </div>
            <div class="gauge-box">
                <Gauge style=""  title="Heap" message="{`${_byteToUnit(_usage.heap.used)}/${_byteToUnit(_usage.heap.total)}`}" value={_usage.heap.used} max={_usage.heap.total} duration={900}></Gauge>
            </div>

            <div class="gauge-box">
                <Gauge style="" title="Buffer"  message="{`${_byteToUnit(_usage.totalBuffer.used)}/${_byteToUnit(_usage.totalBuffer.total)}`}" value={_usage.totalBuffer.used} max={_usage.totalBuffer.total} duration={900}></Gauge>

            </div>
        {/if}

        <div style="margin-top: 10px">
            <div style="margin-top: 10px; font-size: 12pt; font-weight: bold">Client list</div>
            <ul style="padding-left:20px; margin-top: 5px">
            {#each _clientStatuses as client, index}
                <li style="font-size: 11pt; font-weight: 100;">
                ID: {client.id}, {client.name}
                </li>
                <ul style="padding-left: 18px; font-size: 10pt; line-height: 12pt; margin-bottom: 10px;color: #717171">
                    <li><span style="font-weight: 600">Address</span>: {client.address}</li>
                    <li><span style="font-weight: 600">Uptime</span>: {_timeToDMH(client.uptime)}</li>
                    <li><span style="font-weight: 600">Data handlers</span>: {client.dataHandlerCount}</li>
                    <li><span style="font-weight: 600">Active session</span>: {client.activeSessionCount}</li>
                </ul>
            {/each}
            </ul>
        </div>

    </div>

    <AlertLayout bind:show={_showAlert} bind:button={_alertButton} on:close={_onCloseAlert}>
        {@html _alertMessage}
    </AlertLayout>

    <SysinfoPopup show={_showSysInfo} sysInfo={_sysInfo}></SysinfoPopup>


</main>

<style>

    li {

    }

    main {
        margin-top: 20px;
        padding: 10px 10px 0 10px;
        display: block;
    }


    .gauge-box {
        display: inline-block;
        width: calc(25% - 3px);
    }



</style>