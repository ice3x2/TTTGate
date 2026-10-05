<script lang="ts">
    import type {CustomHeader} from '../../controller/Options';
    import Button from '../../ui/Button.svelte';
    import Checkbox from '../../ui/Checkbox.svelte';
    import TextInput from '../../ui/TextInput.svelte';

    let {options = $bindable<CustomHeader[]>([])}: {options?: CustomHeader[]} = $props();

    const uid = $props.id();

    // 옛 layout/HeaderAppender.svelte 14~22행과 같다. 목록이 비면 편집할 빈 행 하나를 둔다.
    $effect(() => {
        if(options.length === 0) options = [{name: '', value: '', replace: false}];
    });

    const add = () => {
        options = [...options, {name: '', value: '', replace: false}];
    };

    const remove = (index: number) => {
        options = options.filter((_item, i) => i !== index);
    };
</script>

<div class="rules">
    {#each options as option, index}
        <div class="rule">
            <TextInput placeholder="Name" bind:value={option.name} />
            <span class="colon">:</span>
            <TextInput placeholder="Value" bind:value={option.value} />
            {#if index === options.length - 1}
                <Button size="sm" onclick={add}>+</Button>
            {:else}
                <Button size="sm" onclick={() => remove(index)}>-</Button>
            {/if}
            <Checkbox class="check" id={`${uid}-replace-${index}`} label="Replace header" bind:checked={option.replace} />
        </div>
    {/each}
</div>

<style>
    .rule {
        display: grid;
        grid-template-columns: 1fr auto 1fr auto;
        gap: var(--s-2);
        align-items: center;
        padding: var(--s-3);
        border: 1px solid var(--line-1);
        border-radius: var(--r-2);
        background: var(--bg-3);
        margin-bottom: var(--s-2);
    }
    .rule .colon { font-family: var(--ff-mono); color: var(--ink-2); text-align: center; }
    .rule :global(.check) { grid-column: 1 / -1; }
</style>
