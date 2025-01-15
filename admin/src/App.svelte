<script lang="ts">

  import LoginCtrl from "./controller/LoginCtrl";
  import ServerStatusCtrl from "./controller/ServerStatusCtrl";
  import ServerSetLayout from "./layout/ServerSetLayout.svelte";
  import TunnelOptionSetLayout from "./layout/TunnelOptionSetLayout.svelte";
  import {onMount} from "svelte";
  import Login from "./layout/Login.svelte";
  import ServerStatusLayout from "./layout/ServerStatusLayout.svelte";
  import SecurityLayout from "./layout/SecurityLayout.svelte";


  type SessionState = 'Checking' | 'Valid' | 'Invalid';

  let _validSession: SessionState = 'Checking';

  let _versionInfo : {name: string, build: string} = {name: '', build: ''};

  onMount(async () => {
      _validSession = (await LoginCtrl.validateSession()) ? 'Valid' : 'Invalid';
      _versionInfo = await ServerStatusCtrl.getVersion();


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

      <SecurityLayout/>
      <ServerSetLayout/>
      <ServerStatusLayout/>

      <TunnelOptionSetLayout/>

    {:else if _validSession === 'Invalid'}
      <Login />
    {:else}
      <div>Offline server...</div>

    {/if}



    <div class="version-box">
      <div class="version-background"></div>
      <div class="version-info-box">
        <div class="version-info">{_versionInfo.name}</div>
        <div class="version-info">{_versionInfo.build}</div>
      </div>
    </div>



</main>

<style>

  .layout-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 10px;
    grid-template-areas:
      "security server"
      "tunnel server";
  }

  .version-box {
    position: fixed;
    bottom: 5px;
    right: 5px;
    width: 60px;
    height: 35px;
    padding: 5px;
    font-size: 10px;
    color: #fff;

  }

  .version-info-box {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    padding: 5px;
    opacity: 0.8;
  }

  .version-background {
    top: 0;
    left: 0;
    opacity: 0.4;
    background: black;
    width: 100%;
    height: 100%;
    position: absolute;
    border-radius: 5px;
  }

  .version-info {
    line-height: 10pt;
    font-size: 8pt;
    color: #fff;
  }


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
