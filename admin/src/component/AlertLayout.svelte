<script lang="ts">
    import {createEventDispatcher} from "svelte";

    const width = 320;
    const height = 150;

    export let show = false;
    export let button = 'Ok';

    const dispatch = createEventDispatcher();

    let _onClose = () => {
        show = false;
        dispatch("close");
    }

</script>
<main style="display: {!show ? 'none' : 'flex'};">
    <div class="background"></div>
    <div class="popup-box" style="height: {height}px; width: {width}px;">
        <div class="content-box" >
            <div style="color: #333">
            <slot ></slot>
            </div>
        </div>
        <div style="width: 100%; display: flex; justify-content: center; align-items: center;"><button style="width: 150px" on:click={_onClose}>{button}</button></div>

    </div>

</main>
<style>

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
        align-items: center;
        justify-content: center;
        display: flex;

        width: 100%;
        height: calc(100% - 30px);
    }
    .popup-box {
        padding: 10px;

        left: 0;
        background: white;
        border-radius: 5px;
        border: 1px solid gray;
        box-shadow: 0 1px 20px rgba(0, 0, 0, 0.5);
        z-index: 1001;
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