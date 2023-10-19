<script lang="ts">

  import LoginCtrl from "./controller/LoginCtrl";
  import ServerStatusCtrl from "./controller/ServerStatusCtrl";
  import ServerSetLayout from "./layout/ServerSetLayout.svelte";
  import TunnelOptionSetLayout from "./layout/TunnelOptionSetLayout.svelte";
  import {onMount} from "svelte";
  import Login from "./layout/Login.svelte";
  import ServerStatusLayout from "./layout/ServerStatusLayout.svelte";


  type SessionState = 'Checking' | 'Valid' | 'Invalid';

  let _validSession: SessionState = 'Checking';

  let _versionInfo : {name: string, build: string} = {name: '', build: ''};

  onMount(async () => {
      _validSession = (await LoginCtrl.validateSession()) ? 'Valid' : 'Invalid';


  });

  ServerStatusCtrl.getVersion()


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
      <div>Offline server...</div>

    {/if}



    <div class="version-box">
      <div class="version-name">{_versionInfo.name}</div>
      <div class="version-build">{_versionInfo.build}</div>
    </div>



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
