<script lang="ts">

  import LoginCtrl from "./controller/LoginCtrl";
  import ServerSetLayout from "./layout/ServerSetLayout.svelte";
  import TunnelOptionSetLayout from "./layout/TunnelOptionSetLayout.svelte";
  import {onMount} from "svelte";
  import Login from "./layout/Login.svelte";
  import AlertLayout from "./component/AlertLayout.svelte";
  import ServerStatusLayout from "./layout/ServerStatusLayout.svelte";

  type SessionState = 'Checking' | 'Valid' | 'Invalid';

  let _validSession: SessionState = 'Checking';

  onMount(async () => {
      _validSession = (await LoginCtrl.validateSession()) ? 'Valid' : 'Invalid';
  });


  let generatePastelColor = (): string => {
    const hue = Math.floor(Math.random() * 360); // 0~359 사이의 색상
    const saturation = 50 + Math.floor(Math.random() * 50); // 50~100 사이의 채도
    const lightness = 70 + Math.floor(Math.random() * 10); // 70~80 사이의 명도

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

</script>

<main>

  <!--<ServerSetLayout/>-->
  <!--<TunnelOptionSetLayout/>-->

    {#if _validSession === 'Valid'}
      <ServerSetLayout/>
      <ServerStatusLayout/>
      <TunnelOptionSetLayout/>
    {:else if _validSession === 'Invalid'}
      <Login />
    {:else}
      <div>Checking...</div>

    {/if}

  <AlertLayout></AlertLayout>



</main>

<style>
  main {
    left: 0;
    top: 0;
    position: fixed;
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: auto;
    padding-bottom: 10px;
    box-sizing: border-box;
  }
</style>
