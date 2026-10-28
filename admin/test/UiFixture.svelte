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
    let tallModalOpen = $state(false);
    let tinyModalOpen = $state(false);
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
<!-- 본문이 길고 첫 초점 대상이 본문 아래쪽에 있는 모달. 열었을 때 초점이 화면에 보이는지 본다. -->
<div id="open-tall-modal"><Button onclick={() => (tallModalOpen = true)}>Open tall modal</Button></div>
<Modal bind:open={tallModalOpen} title="Tall fixture modal">
    <div style="height: 900px;">Tall body</div>
    <Button onclick={() => {}}>Body action</Button>
    {#snippet footer()}<Button variant="primary" onclick={() => (tallModalOpen = false)}>Close tall modal</Button>{/snippet}
</Modal>

<div id="toast-push"><Button onclick={() => toast.push({tone: 'pulse', message: 'Fixture toast', timeoutMs: 1500})}>Push toast</Button></div>
<!-- 스스로 사라지지 않는 토스트. 쌓이는 상한을 시간과 무관하게 확인한다(#263). -->
<div id="toast-push-sticky"><Button onclick={() => toast.push({tone: 'trace', message: 'Sticky toast', timeoutMs: 0})}>Push sticky toast</Button></div>

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
<!-- 본문이 없는 아주 작은 모달. 낮은 화면에서도 들어가므로 가운데에 놓여야 한다. -->
<div id="open-tiny-modal"><Button onclick={() => (tinyModalOpen = true)}>Open tiny modal</Button></div>
<Modal bind:open={tinyModalOpen} title="Tiny fixture modal">
    {#snippet footer()}<Button variant="primary" onclick={() => (tinyModalOpen = false)}>Close tiny modal</Button>{/snippet}
</Modal>
