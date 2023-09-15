<script lang="ts">
import Gauge from "../component/Gauge.svelte";
import ServerStatusCtrl from "../controller/ServerStatusCtrl";

import {InvalidSession,type ClientStatus,type  SysStatus} from "../controller/Types";
import AlertLayout from "../component/AlertLayout.svelte";
import {onMount} from "svelte";
import ExMath from "../controller/ExMath";

let _showAlert = false;
let _alertMessage = "";
let _alertButton = "Ok";
let _intervalId : any;


let _onCloseAlert = () => {};

let _serverStatus : {system: SysStatus, clients: ClientStatus} | undefined;

let _cpuPercentage = 0;
let _heapUsage = { used: 0,  total: 0 }
let _bufferUsage = { used: 0,  total: 0 }
let _memoryUsage = { free: 0,  total: 0, process: 0 }

onMount(async () => {
    if(!_intervalId) {
        _startStatusUpdate();
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
        _serverStatus = await ServerStatusCtrl.instance.getStatus();
        _cpuPercentage = _serverStatus.system.cpu;
        _heapUsage = _serverStatus.system.heap;
        _bufferUsage = _serverStatus.system.totalBuffer;
        _memoryUsage = _serverStatus.system.memory;
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

let _byteToUnit = (length: number) : string => {
    const tib = 1024 * 1024 * 1024 * 1024;
    const gib = 1024 * 1024 * 1024;
    const mib = 1024 * 1024;
    const kib = 1024;
    if(length > tib) {
        return `${ExMath.round(length / tib, 1)}TiB`;
    } else if(length > gib) {
        return `${ExMath.round(length / gib, 1)}GiB`;
    } else if(length > mib) {
        return `${ExMath.round(length / mib, 1)}MiB`;
    } else if(length > kib) {
        return `${ExMath.round(length / kib, 1)}KiB`;
    } else {
        return `${length}B`;
    }
}


</script>

<main>
    <h2 class="title">
        Status
    </h2>
    <div class="round-box">
        <div class="gauge-box">
            <div>CPU</div>
            <Gauge style="width: 115px" value={_cpuPercentage} duration={900}></Gauge>
        </div>
        <div class="gauge-box">
            <div>Memory</div>
            <Gauge style="width: 115px" value={_memoryUsage.process} max={_memoryUsage.total} duration={900}></Gaug<div  class="status-value-box">{_byteToUnit(_memoryUsage.process)}/{_byteToUnit(_memoryUsage.total)}</div>
        </div>
        <div class="gauge-box">
            <div>Heap</div>
            <Gauge style="width: 115px" value={_heapUsage.used} max={_heapUsage.total} duration={900}></Gauge>
            <div  class="status-value-box">{_byteToUnit(_heapUsage.used)}/{_byteToUnit(_heapUsage.total)}</div>
        </div>

        <div class="gauge-box">
            <div>Buffer</div>
            <Gauge style="width: 115px" value={_bufferUsage.used} max={_bufferUsage.total} duration={900}></Gauge>
            <div class="status-value-box">{_byteToUnit(_bufferUsage.used)}/{_byteToUnit(_bufferUsage.total)}</div>
        </div>

    </div>

    <AlertLayout bind:show={_showAlert} bind:button={_alertButton} on:close={_onCloseAlert}>
        {@html _alertMessage}
    </AlertLayout>



</main>

<style>
    main {
        margin-top: 20px;
        padding: 10px 10px 0 10px;
        display: block;
    }

    .gauge-box {
        display: inline-block;
        width: 118px;
    }

    .status-value-box {
        margin-top: -10px;
        position: absolute;
        font-size: 8pt;
    }

</style>