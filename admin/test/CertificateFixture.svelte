<script lang="ts">
    import InputCertFile from '../src/layout/InputCertFile.svelte';
    import Gauge from '../src/component/Gauge.svelte';
    import Timer from '../src/component/Timer.svelte';
    import type {CertInfo} from '../src/controller/Types';

    export let auxiliary = false;
    let certificate: CertInfo | null = (window as any).initialCertificate ?? {
        key: {name: '', value: ''}, cert: {name: '', value: ''}, ca: {name: '', value: ''},
    };
    let width = 250;
    let updates = 0;
    let gaugeValue = 0;
    let timer: Timer;

    (window as any).certificateFixture = {
        replace: (value: CertInfo | null) => { certificate = value; },
        mutate: (value: CertInfo) => {
            certificate!.key = value.key;
            certificate!.cert = value.cert;
            certificate!.ca = value.ca;
        },
        updateAuxiliary: () => { gaugeValue = 50; timer.reset(120); timer.update(60, 120); },
    };
</script>

{#if auxiliary}
    <Gauge value={gaugeValue} duration={0} title="Auxiliary gauge" />
    <Timer bind:this={timer} />
{:else}
    <button on:click={() => width++}>Parent redraw</button>
    <InputCertFile certInfo={certificate} {width} hideMessage={true}
        on:update={(event) => { certificate = event.detail; updates++; }} />
    <output id="updates">{updates}</output>
    <pre id="certificate">{JSON.stringify(certificate)}</pre>
{/if}
