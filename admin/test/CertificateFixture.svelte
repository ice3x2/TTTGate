<script lang="ts">
    import InputCertFile from '../src/layout/InputCertFile.svelte';
    import Gauge from '../src/ui/Gauge.svelte';
    import Timer from '../src/ui/Timer.svelte';
    import type {CertInfo} from '../src/controller/Types';

    export let auxiliary = false;
    let certificate: CertInfo | null = (window as any).initialCertificate ?? {
        key: {name: '', value: ''}, cert: {name: '', value: ''}, ca: {name: '', value: ''},
    };
    let width = 250;
    let updates = 0;
    let gaugeValue = 0;
    let timerTotal = 0;
    let timerSeconds = 0;

    (window as any).certificateFixture = {
        replace: (value: CertInfo | null) => { certificate = value; },
        mutate: (value: CertInfo) => {
            certificate!.key = value.key;
            certificate!.cert = value.cert;
            certificate!.ca = value.ca;
        },
        updateAuxiliary: () => { gaugeValue = 50; timerTotal = 120; timerSeconds = 60; },
    };
</script>

{#if auxiliary}
    <Gauge value={gaugeValue} max={100} duration={0} title="Auxiliary gauge" message="" />
    <Timer seconds={timerSeconds} total={timerTotal} />
{:else}
    <button on:click={() => width++}>Parent redraw</button>
    <InputCertFile certInfo={certificate} {width} hideMessage={true}
        on:update={(event) => { certificate = event.detail; updates++; }} />
    <output id="updates">{updates}</output>
    <pre id="certificate">{JSON.stringify(certificate)}</pre>
{/if}
