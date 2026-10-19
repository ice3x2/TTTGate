<script lang="ts">
    import InputCertFile from '../src/screens/parts/InputCertFile.svelte';
    import Gauge from '../src/ui/Gauge.svelte';
    import Timer from '../src/ui/Timer.svelte';
    import type {CertInfo} from '../src/controller/Types';

    let {auxiliary = false}: {auxiliary?: boolean} = $props();

    let certificate = $state<CertInfo | null>((window as any).initialCertificate ?? {
        key: {name: '', value: ''}, cert: {name: '', value: ''}, ca: {name: '', value: ''},
    });
    let redraws = $state(0);
    let updates = $state(0);
    let gaugeValue = $state(0);
    let timerTotal = $state(0);
    let timerSeconds = $state(0);

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
    <button onclick={() => redraws++}>Parent redraw</button>
    <InputCertFile certInfo={certificate} hideMessage={true}
        onupdate={(value) => { certificate = value; updates++; }} />
    <output id="updates">{updates}</output>
    <output id="redraws">{redraws}</output>
    <pre id="certificate">{JSON.stringify(certificate)}</pre>
{/if}
