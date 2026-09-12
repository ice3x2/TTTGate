<script lang="ts">
    import '../src/app.css';
    import Button from '../src/ui/Button.svelte';
    import Field from '../src/ui/Field.svelte';
    import TextInput from '../src/ui/TextInput.svelte';
    import NumberInput from '../src/ui/NumberInput.svelte';
    import Select from '../src/ui/Select.svelte';
    import Checkbox from '../src/ui/Checkbox.svelte';
    import Switch from '../src/ui/Switch.svelte';
    import Card from '../src/ui/Card.svelte';
    import Chip from '../src/ui/Chip.svelte';
    import Badge from '../src/ui/Badge.svelte';
    import Modal from '../src/ui/Modal.svelte';
    import {toast} from '../src/ui/toast';
    import Toast from '../src/ui/Toast.svelte';
    import Tabs from '../src/ui/Tabs.svelte';
    import Kpi from '../src/ui/Kpi.svelte';
    import Gauge from '../src/ui/Gauge.svelte';
    import Loading from '../src/ui/Loading.svelte';
    import Timer from '../src/ui/Timer.svelte';
    import Banner from '../src/ui/Banner.svelte';

    let count = $state(0);
    let text = $state('');
    let number: number | null = $state(null);
    let selected = $state('a');
    let checked = $state(false);
    let on = $state(false);
    let switchEvents = $state(0);
    let modalOpen = $state(false);
    let tab = $state('one');
    let timerValue = $state(-1);
    let bannerShown = $state(true);
</script>

<div id="btn-count"><Button variant="primary" onclick={() => count++}>Count</Button></div>
<output id="count">{count}</output>

<Button disabled>Disabled</Button>

<Field label="Text" for="text-input">
    <TextInput id="text-input" bind:value={text} />
</Field>
<output id="text-echo">{text}</output>

<Field label="Number" for="number-input" error={number !== null && number > 10 ? 'Too large' : undefined}>
    <NumberInput id="number-input" min={0} max={100} bind:value={number} />
</Field>
<output id="number-echo">{String(number)}</output>

<Field label="Select" for="select">
    <Select id="select" options={[{value: 'a', label: 'A'}, {value: 'b', label: 'B'}]} bind:value={selected} />
</Field>
<output id="select-echo">{selected}</output>

<Checkbox id="checkbox" label="Fixture checkbox" bind:checked={checked} />
<output id="checkbox-echo">{String(checked)}</output>

<Switch ariaLabel="Fixture switch" bind:on={on} onchange={() => switchEvents++} />
<output id="switch-echo">{String(on)}</output>
<output id="switch-events">{switchEvents}</output>

<Card label="Fixture card"><p>Card body</p></Card>
<Card ticked compact>Ticked</Card>

<Chip mono>1.0.11b</Chip>

<Badge tone="signal">SIGNAL</Badge>
<Badge tone="pulse">PULSE</Badge>
<Badge tone="alarm">ALARM</Badge>
<Badge tone="trace">TRACE</Badge>
<Badge tone="warn">WARN</Badge>
<Badge tone="neutral">NEUTRAL</Badge>

<div id="open-modal"><Button onclick={() => (modalOpen = true)}>Open modal</Button></div>
<Modal bind:open={modalOpen} title="Fixture modal">
    <p>Modal body</p>
    {#snippet footer()}<Button variant="primary" onclick={() => (modalOpen = false)}>Close modal</Button>{/snippet}
</Modal>

<div id="toast-push"><Button onclick={() => toast.push({tone: 'pulse', message: 'Fixture toast', timeoutMs: 1500})}>Push toast</Button></div>

<Tabs items={[{id: 'one', label: 'One'}, {id: 'two', label: 'Two'}]} bind:active={tab} />
<output id="tab-echo">{tab}</output>

<Kpi label="Sessions" value="12" sub="fixture" accent />

<Gauge title="CPU" value={50} max={100} message="50/100%" duration={0} />

<Loading />

<Timer seconds={60} total={120} onchange={(s) => (timerValue = s)} />
<output id="timer-echo">{timerValue}</output>

{#if bannerShown}
    <Banner tone="trace" dismissible ondismiss={() => (bannerShown = false)}>Fixture banner</Banner>
{/if}

<Toast />
