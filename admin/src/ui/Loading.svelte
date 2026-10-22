<script lang="ts">
    import loadingImg from '../assets/loading.png';

    let {
        overlay = false,
        class: className = '',
    }: {
        overlay?: boolean;
        class?: string;
    } = $props();
</script>

<div class="loading {overlay ? 'overlay' : ''} {className}" role="status" aria-label="Loading">
    <img src={loadingImg} alt="" class="spin">
</div>

<style>
    .loading.overlay{
        position: fixed; inset: 0; z-index: 90;
        display: flex; align-items: center; justify-content: center;
        background: rgba(14,18,24,.5);
    }
    .loading:not(.overlay){ display: inline-flex; }
    .spin{
        width: 48px; height: 48px;
        animation: spin 1.6s steps(8) infinite;
    }
    @keyframes spin{
        to{ transform: rotate(360deg); }
    }
</style>
