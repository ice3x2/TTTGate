<script lang="ts">
    import {createEventDispatcher, onMount, afterUpdate} from "svelte";
    import infinity from '../assets/infinity.png';
    import AlertLayout from "../component/AlertLayout.svelte";

    export let style = '';


    let _time : number = 0;
    let _startTime : number = -1;
    const TIME_WEIGHT = 20;
    const MAX_INFINITY_TIME = 100;

    let _isInfinity = false;

    let _timeMax = _time * TIME_WEIGHT;
    let _leftTime = _time * TIME_WEIGHT;
    let _handEle: HTMLDivElement;

    const START_DEG = 95;
    const END_DEG = 440;

    let _isShowSetTime = false;


    let _dispatcher = createEventDispatcher();




    export const reset = (time? : number) :void => {
        if(_time != undefined) {
            _time = time;
            _startTime = time;
            if(_startTime <= 0) {
                _isInfinity = true;
                return;
            }
        }
        _isInfinity = false;
        _timeMax = _startTime * TIME_WEIGHT;
        _leftTime = _startTime * TIME_WEIGHT;


    }


    let _mapValue = (value: number, in_min: number, in_max: number, out_min: number, out_max: number) => {
        return (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
    }

    let _update = () => {
        if (_handEle) {
            let deg = Math.floor(_mapValue(_timeMax - _leftTime, 0, _timeMax, START_DEG, END_DEG));
            _handEle.style.rotate = `${deg}deg`;
            _leftTime--;
            if(_leftTime <= 0 && _startTime <= 0) {
                _timeMax = MAX_INFINITY_TIME;
                _leftTime = _timeMax;
            }
            else if (_leftTime <= 0 ) {
                _leftTime = 0;
            }
        }
    }


    export const update = (time: number, startTime? : number) => {
        if(startTime != undefined) {
            _startTime = startTime;
            if(startTime <= 0) {
                _isInfinity = true;
                return;
            } else if(startTime > 0) {
                _isInfinity = false;
                _timeMax = _startTime * TIME_WEIGHT;
            }
        }
        if(_startTime <=0) return;
        _time = time;
        _leftTime = _time * TIME_WEIGHT;
        _update();
    }



    onMount(async () => {
        if (_handEle) {
            _handEle.style.rotate = `${START_DEG}deg`;
        }
    });





    let _getTimeString = (leftTime: number): string => {
        let spanTag = `<span style="font-size: 12px">`;

        if (leftTime <= 0) {
            return `0${spanTag}m</span> 0${spanTag}s</span>`;
        }



        let min = Math.floor(leftTime / 60) % 60;
        let hour = Math.floor(leftTime / 60 / 60) % 24;
        let sec = Math.floor(leftTime % 60);
        let day = Math.floor(leftTime / 60 / 60 / 24);





        if (day > 0) {
            return `${day}${spanTag}d</span> ${hour}${spanTag}h</span> ${spanTag}${min}m</span>`;
        }
        if (hour > 0) {
            return `${hour}${spanTag}h</span> ${min}${spanTag}m</span> ${spanTag}${sec}s</span>`;
        }

        return `${min}${spanTag}m</span> ${sec}${spanTag}s</span>`;
    }


    let _showSetTime = () => {
        _isShowSetTime = true;
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

    let _onCloseSetTimeoutAlert = () => {
        let dayValue = parseInt((document.getElementById('input-timeout-day') as HTMLInputElement).value);
        let hourValue = parseInt((document.getElementById('input-timeout-hour') as HTMLInputElement).value);
        let minValue = parseInt((document.getElementById('input-timeout-min') as HTMLInputElement).value);
        dayValue = isNaN(dayValue) ? 0 : dayValue;
        hourValue = isNaN(hourValue) ? 0 : hourValue;
        minValue = isNaN(minValue) ? 0 : minValue;
        let oldTime = _startTime;
        _startTime = (dayValue * 24 * 60 * 60) + (hourValue * 60 * 60) + (minValue * 60);
        if(_startTime != 0) {
            _timeMax = _startTime * TIME_WEIGHT;
            _leftTime = _startTime * TIME_WEIGHT;
        } else {
            _timeMax = MAX_INFINITY_TIME;
            _leftTime = MAX_INFINITY_TIME;
        }
        if(oldTime != _startTime) {
            _dispatcher('change', {time: _startTime});
        }
    }

</script>
<svelte:options accessors/>
<div class="main" style="{style}">

    <div class="time-text" style="{_startTime <= 0 ? 'min-width: 30px' : ''}">
        {#if _time >= 0 && _startTime > 0}
            {@html _getTimeString(_time > 0 ?  _leftTime / TIME_WEIGHT : 0)}
        {:else if _startTime === 0}
            <img src={infinity} style="width: 20px; height: 20px; margin-right: 0px; vertical-align: middle;"/>
            <div style="width: 20px; height: 1px; background: 1px; background: #333;position: absolute;left: 10px; margin-top: -3px;"></div>
        {/if}
    </div>

    <div class="clock" style="display: {_time < 0 ? 'none' : ''}">
        <div class="T-L"></div>
        <div class="T-I"></div>
        <div class="circle"></div>
        <div class="end-point"></div>
        <div class="axis"></div>
        <div class="second-hand {_isInfinity ? 'second-hand-animation' : ''}" bind:this={_handEle}></div>
    </div>
    <AlertLayout on:close={_onCloseSetTimeoutAlert} bind:show={_isShowSetTime}>
        <div style="display: block; font-size: 12pt; margin-bottom: 15px; font-weight: bold">
            Tunneling activity restriction time
        </div>
        <div style="width: 100%; text-align: center">
        <div style="display: block; font-size: 12pt">
            <input id="input-timeout-day" type="number" min="0" max="99999" on:keyup={_enforceMinMax} style="width: 40px; text-align: right" value={Math.floor(_startTime / 60 / 60 / 24)}>d&nbsp;
            <input id="input-timeout-hour" type="number" min="0" max="23" on:keyup={_enforceMinMax} style="width: 40px; text-align: right" value={Math.floor(_startTime / 60 / 60) % 24}>h&nbsp;
            <input id="input-timeout-min" type="number" min="0" max="59" on:keyup={_enforceMinMax} style="width: 40px; text-align: right" value={Math.floor(_startTime / 60) % 60}>m&nbsp;
        </div>
        </div>
    </AlertLayout>

    <div role="button" on:click={_showSetTime} style="cursor: pointer;position: absolute; top: -5px; left: 0; width: 100%; height: 100%;"></div>


</div>
<style>
    .main {
        display: inline;
    }

    .clock {
        width: 25px;
        height: 25px;
        display: inline-block;
        position: relative;
        vertical-align: center;
    }

    .time-text {
        display: inline-block;
        text-align: right;
        min-width: 55px;
        position: relative;
        vertical-align: top;
        font-size: 12pt;
        text-decoration: underline;
        cursor: pointer;
        height: 25px;
    }


    .T-I {
        width: 4px;
        height: 3px;
        position: absolute;
        top: -3px;
        left: calc(50% - 2px);
        background-color: #000;
        border: 1px solid black;
    }

    .T-L {
        width: 8px;
        height: 2px;
        position: absolute;
        top: -4px;
        left: calc(50% - 4px);
        background-color: #000;
        border: 1px solid black;
    }

    .circle {
        width: 100%;
        height: 100%;
        background-color: #fff;
        border: 3px solid black;
        border-radius: 50%;
    }

    .axis {
        width: 4px;
        height: 4px;
        background-color: #000;
        border: 1px solid black;
        border-radius: 50%;
        position: absolute;
        top: calc(50% - 2px);
        left: calc(50% - 2px);
    }

    .end-point {
        width: 1px;
        height: 8px;
        background-color: red;
        position: absolute;
        top: 3px;
        transform: rotate(-5deg);
        left: calc(50% - 1px);
    }

    .second-hand {
        position: absolute;
        transform-origin: center bottom;
    }

    .second-hand-animation {
        animation: rotateSeconds 0.5s linear infinite;
    }

    .second-hand {
        width: 2px;
        height: 8px;
        background-color: black;
        top: 5px;
        left: calc(50% - 1px);
        transform: rotate(270deg);
    }

    @keyframes rotateSeconds {
        0% {
            transform: rotate(270deg);
        }
        100% {
            transform: rotate(630deg);
        }
    }



</style>