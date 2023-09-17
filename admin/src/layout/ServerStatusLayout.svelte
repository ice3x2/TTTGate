<script lang="ts">
import Gauge from "../component/Gauge.svelte";
import ServerStatusCtrl from "../controller/ServerStatusCtrl";
import CpuIcon from "../assets/cpu.png";

import {InvalidSession,type ClientStatus,type  SysStatus} from "../controller/Types";
import AlertLayout from "../component/AlertLayout.svelte";
import {onMount} from "svelte";
import ExMath from "../controller/ExMath";

let _showAlert = false;
let _alertMessage = "";
let _alertButton = "Ok";
let _intervalId : any;
let _alertHeight = 150;

let _onCloseAlert = () => {};

let _serverStatus : {system: SysStatus, clients: ClientStatus} | undefined;

let _cpuPercentage = 0;
let _cpuAllPercentage = 0;
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
        _cpuPercentage = _serverStatus.system.cpu.process;
        _cpuAllPercentage = _serverStatus.system.cpu.total;
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
    _alertHeight = 500;
    _alert(`<h4>HW Info</h4>
            <div>CPU: ${_serverStatus.system.cpuInfo.model}</div>
            <div>Clock: ${_serverStatus.system.cpuInfo.speed}</div>
            <div>Cores: ${_serverStatus.system.cpuInfo.cores}</div>
            <div>RAM: ${_byteToUnit(_serverStatus.system.memory.total)}</div>

            <h4>OS Info</h4>
            <div>Type: ${_serverStatus.system.osInfo.type}</div>
            <div>Platform: ${_serverStatus.system.osInfo.platform}</div>
            <div>Release: ${_serverStatus.system.osInfo.release}</div>
            <div>hostname: ${_serverStatus.system.osInfo.hostname}</div>

`, 'OK');

}

</script>

<main>
    <h2 class="title">
        Status
    </h2>
    <div class="round-box">
        <div style="display: flex; align-items: center; cursor: pointer; margin-bottom: 5px" on:click={onClickShowInfo}>
            <img src={CpuIcon} width="16" height="16" alt="info">
            <span style="margin-left: 2px; font-size: 10pt; text-decoration: underline;color: #555;">INFO</span>
        </div>
        <div class="gauge-box">

            <Gauge style="" title="CPU" message="{`${_cpuPercentage}/${_cpuAllPercentage}%`}" value={_cpuPercentage} duration={900}></Gauge>
        </div>
        <div class="gauge-box">
            <Gauge style=""   title="Memory"  message={`${_byteToUnit(_memoryUsage.process,true)}/${_byteToUnit(_memoryUsage.total)}`}  value={_memoryUsage.process} max={_memoryUsage.total} duration={900}/>
          <!--  <div  class="status-value-box">{_byteToUnit(_memoryUsage.process)}/{_byteToUnit(_memoryUsage.total)}</div>-->
        </div>
        <div class="gauge-box">
            <Gauge style=""  title="Heap" message="{`${_byteToUnit(_heapUsage.used)}/${_byteToUnit(_heapUsage.total)}`}" value={_heapUsage.used} max={_heapUsage.total} duration={900}></Gauge>
        </div>

        <div class="gauge-box">
            <Gauge style="" title="Buffer"  message="{`${_byteToUnit(_bufferUsage.used)}/${_byteToUnit(_bufferUsage.total)}`}" value={_bufferUsage.used} max={_bufferUsage.total} duration={900}></Gauge>

        </div>

    </div>

    <AlertLayout height={_alertHeight} bind:show={_showAlert} bind:button={_alertButton} on:close={_onCloseAlert}>
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
        width: calc(25% - 3px);
    }



</style>