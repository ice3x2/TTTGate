<script lang="ts">
    import {createEventDispatcher} from "svelte";
    import AlertLayout from "../component/AlertLayout.svelte";
    import SecurityBlockCountryLayout from "./SecurityBlockCountryLayout.svelte";
    import SecurityBlockIPLayout from "./SecurityBlockIPLayout.svelte";
    import SecurityAutoBlockLayout from "./SecurityAutoBlockLayout.svelte";

    let dispatch = createEventDispatcher();

    export let show = false;
    export let port = 0;
    export let destinationPort = 0;
    export let destinationHost = '';




</script>

<main style="{show? 'display: block' : 'display: none'}">

    <AlertLayout width="90%" height="auto"  bind:show={show} button={'Close'}  on:close={()=> dispatch('close')}>
        <div>
            <h2 class="title" style="margin-bottom: -5px">
                Security
            </h2>
            <div style="font-weight: bold">
                {port}
                ⬌
                {destinationHost}:{destinationPort}
            </div>
            <div>
                <SecurityBlockCountryLayout></SecurityBlockCountryLayout>
                <SecurityBlockIPLayout></SecurityBlockIPLayout>
                <SecurityAutoBlockLayout></SecurityAutoBlockLayout>

            </div>
        </div>

        <br/>


    </AlertLayout>






</main>

<style>
    main {
        display: block;
    }
</style>