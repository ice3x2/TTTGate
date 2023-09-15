<script lang="ts">
    import {createEventDispatcher, onMount, afterUpdate, beforeUpdate} from "svelte";
    import ObjectUtil from "../controller/ObjectUtil";
    import ExMath from "../controller/ExMath";


    export let style = '';
    export let max = 100;
    export let min = 0;
    export let value = 0;
    export let duration = 1000;

    let _needleElement: HTMLDivElement;


    const START_ANGLE = -82;
    const END_ANGLE = 82;

    let _currentAngle = -82;
    let _currentAnimate : Animation | null = null;
    let _percent = 0;
    let _oldValues = {min, max, value};


    onMount(() => {
        if(_needleElement) {
            _update();
        }

    })

    beforeUpdate(() => {
        if(value < min) {
            value = min;
        }
        else if(value > max) {
            value = max;
        }
        if(max <= 0) {
            max = 1;
        }

        if(!ObjectUtil.equalsDeep(_oldValues, {min, max, value})) {

            _update();
            _oldValues = {min, max, value};
        }
    })



    let _update = () => {
        if(!_needleElement) {
            return;
        }
        _percent = ExMath.round(ExMath.map(value, min, max, 0, 100), 1);
        let angle = ExMath.map(value, min, max, START_ANGLE, END_ANGLE);

        _needleToAngle(angle);
    }



    let _needleToAngle = (angle: number) => {
        if(!_needleElement) {
            return;
        }

        angle = Math.round(angle);
        if(angle < START_ANGLE) {
            angle = START_ANGLE;
        }
        else if(angle > END_ANGLE) {
            angle = END_ANGLE;
        }
        if(_currentAngle == angle) {
            return;
        }
        _currentAnimate?.pause();
        setTimeout(() => {
            _currentAnimate = _needleElement.animate([
                {transform: `rotate(${_currentAngle}deg)`},
                {transform: `rotate(${angle}deg)`}
            ], {
                duration: duration,
                easing: 'ease-in-out',
                fill: 'forwards'
            });
            _currentAngle = angle;
        }, 0);

    }




</script>
<svelte:options accessors/>
<div class="main" style="{style}">
    <div class="gauge-container">
        <div class="gauge"></div>

        <div class="tick-mark mark-center"></div>
        <div class="tick-mark mark-30"></div>
        <div class="tick-mark mark-60"></div>
        <div class="tick-mark mark-90"></div>
        <div class="tick-mark mark-120"></div>
        <div class="tick-mark mark-150"></div>
        <div class="gauge-background"></div>
        <div class="needle" bind:this={_needleElement}></div>
        <div class="gauge-border-bottom"></div>
        <div class="gauge-ball"></div>
        <!-- Add more tick marks here -->
    </div>


    <div class="percent-box">{_percent}%</div>


</div>
<style>
    .main {
        display: inline;
    }

    .percent-box {
        display: inline-block;
        font-weight: bold;
        font-size: 18pt;
    }

    .gauge-container {
        display: inline-block;
        position: relative;
        height: 25px;
        min-width: 40px;
    }

    .gauge {
        width: 40px;
        height: 20px;
        border: solid 3px #000;
        border-radius:  20px 20px 0 0;
        position: absolute;
        bottom: 0;
        left: 0;

    }

    .gauge-background {
        width: 28px;
        height: 14px;
        background: white;


        border-radius: 14px 14px 0 0;
        position: absolute;
        bottom: 0;
        left: 6px;
    }

    .gauge-ball {
        width: 6px;
        height: 3px;
        background: black;
        border-radius: 3px 3px 0 0;
        position: absolute;
        bottom: 2px;
        left: 18px;
    }

    .gauge-border-bottom {
        width: 40px;
        height: 3px;
        background: #000;
        position: absolute;
        bottom: 0;
        left: 0;
    }

    .needle {
        width: 2px;
        height: 17px;
        background-color: red;
        position: absolute;
        bottom: 0;
        margin-bottom: 1px;
        left: 20px;
        transform-origin: center bottom;
        transform: rotate(-82deg); /* Adjust the rotation angle as needed */
        transition: transform 0.5s ease-in-out;
    }

    .tick-mark {
        width: 2px;
        height: 20px;
        background-color: #333;
        position: absolute;
        bottom: 0;
        left: 19px;
        transform-origin: center bottom;
    }


    .mark-30 {
        transform: rotate(-60deg);
    }

    .mark-60 {
        transform: rotate(-30deg);
    }

    .mark-90 {
        transform: rotate(0deg);
    }

    .mark-120 {
        transform: rotate(30deg);
    }


    .mark-150 {
        transform: rotate(60deg);
    }




</style>