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

    let count = $state(0);
    let text = $state('');
    let number: number | null = $state(null);
    let selected = $state('a');
    let checked = $state(false);
    let on = $state(false);
    let switchEvents = $state(0);
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
