<script lang="ts">

    import {createEventDispatcher} from "svelte";

    export let on = false;
    export let style = '';
    let _oldOn = on;
    let _dispatch = createEventDispatcher();

    $: {
        if (on != _oldOn) {
            console.log(`change: new: ${on}, old: ${_oldOn}`)
            _dispatch('change', {on});
            _oldOn = on;
        }
    }

    let _onClick = () => {
        on = !on;
    }


</script>
<div  class="switch-box " style="{style}" >

    <div class="switch-background {!on ? 'switch-background-off' : 'switch-background-on'}"></div>
    <div class="switch-button  {!on ? 'switch-button-off' : 'switch-button-on'}" >
        {#if on}
            <div  class="center-box" style="font-weight: bold; width: 1px; height: 12px; border: 1px solid #20c997;top: calc(50% - 6px);left: calc(50% - 1px);"></div>
        {:else}
            <div  class="center-box" style="border-radius: 10px; width: 10px; height: 10px; top: calc(50% - 5px);left: calc(50% - 5px);  border: 1px solid #444;"></div>
        {/if}

    </div>


    <button class="translate-button"  on:click={_onClick}></button>



</div>



<style>
    div {
        box-sizing: border-box;
        cursor: pointer;
    }
    .switch-box  {
        display: inline-block;
        width: 50px;
        height: 25px;
        border-radius: 5px;
        border: solid 3px #333;
        position: relative;
        background: #fff;
        box-sizing: border-box;

    }

    .translate-button, .translate-button:hover, .translate-button:active, .translate-button:focus {
        position: absolute;
        left: -3px;
        top: -3px;
        width: calc(100% + 6px);
        height: calc(100% + 6px);
        outline: none;
        border: none;
        background: transparent;
        border-radius: 5px;

    }



    .switch-background {
        background-color: #333;
        top: 0;
        left: 0;
        height: 100%;
    }

    .switch-background-on {
        animation-name: expand-to-right;
        animation-duration: 0.3s;
        width: 100%;
    }

    .switch-background-off {
        animation-name: expand-to-left;
        animation-duration: 0.3s;
        width: 0;
    }

    @keyframes expand-to-right {
        from {
            width: 0;
        }
        to {
            width: 100%;
        }
    }

    @keyframes expand-to-left {
        from {
            width: 100%;
        }
        to {
            width: 0;
        }
    }


    .switch-button  {
        width: 28px;
        height: 25px;
        border-radius: 5px;
        border: solid 3px #333;
        background-color: #fff;
        position: absolute;
        top: -3px;
        transition: left 0.3s;
    }

    .switch-button-on {
        right: -3px;
        animation-duration: 0.3s;
        animation-name: slide-to-right;
    }

    .switch-button-off {
        left: -3px;
        animation-duration: 0.3s;
        animation-name: slide-to-left;
    }


    @keyframes slide-to-left {
        from {
            left: 19px;
        }
        to {
            left: -3px;
        }
    }

    @keyframes slide-to-right {
        from {
            right: 19px;
        }
        to {
            right: -3px;
        }
    }

    .center-box {
        position: absolute;
        width: 100%;
        height: 100%;



    }


</style>