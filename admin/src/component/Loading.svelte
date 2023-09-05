<script lang="ts">
    import loadingImg from '../assets/loading.png';
    import {onMount} from "svelte";

    export let show = false;

    let _imageElement: HTMLImageElement;
    let _rotationDegree = 0;

    onMount(() => {
        if(_imageElement) {
            _imageElement.onload = () => {
                setInterval(_rotateImage, 200);
            }
        }
    });

    let _rotateImage = () => {
        _rotationDegree += 45;
        if(_imageElement) {
            _imageElement.style.transform = `rotate(${_rotationDegree}deg)`;
        }

    }

</script>
<main style="display: {show ? 'flex' : 'none'}">
    <div class="background"></div>
    <div class="progress">
        <img src={loadingImg} bind:this={_imageElement} />
    </div>
</main>
<style>


    main {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    }

    .background {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;

        background: rgba(0, 0, 0, 0.5);
        z-index: 1000;
    }
</style>