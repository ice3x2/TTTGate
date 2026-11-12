<script lang="ts">
    import type {RewriteRule} from '../../controller/Options';
    import Button from '../../ui/Button.svelte';
    import Field from '../../ui/Field.svelte';
    import TextInput from '../../ui/TextInput.svelte';
    import {t} from '../../i18n';

    let {options = $bindable<RewriteRule[]>([])}: {options?: RewriteRule[]} = $props();

    const uid = $props.id();

    // 옛 layout/BodyReplaceAppender.svelte 15~23행과 같다. 목록이 비면 편집할 빈 행 하나를 둔다.
    $effect(() => {
        if(options.length === 0) options = [{from: '', to: ''}];
    });

    const add = () => {
        options = [...options, {from: '', to: ''}];
    };

    const remove = (index: number) => {
        options = options.filter((_item, i) => i !== index);
    };
</script>

<div class="rules">
    {#each options as option, index}
        <div class="rule">
            <Field label={t('rewrite.from')} for={`${uid}-from-${index}`}>
                <TextInput id={`${uid}-from-${index}`} bind:value={option.from} />
            </Field>
            <Field label={t('rewrite.to')} for={`${uid}-to-${index}`}>
                <TextInput id={`${uid}-to-${index}`} bind:value={option.to} />
            </Field>
            <div class="rule-actions">
                {#if index === options.length - 1}
                    <Button variant="secondary" onclick={add}>{t('common.add')}</Button>
                {:else}
                    <Button variant="secondary" onclick={() => remove(index)}>{t('common.remove')}</Button>
                {/if}
            </div>
        </div>
    {/each}
    <p class="hint">{t('rewrite.fromHint')}</p>
</div>

<style>
    .rule {
        display: flex;
        flex-direction: column;
        gap: var(--s-3);
        padding: var(--s-3);
        border: 1px solid var(--line-1);
        border-radius: var(--r-2);
        background: var(--bg-3);
        margin-bottom: var(--s-2);
    }
    .rule-actions { display: flex; justify-content: flex-end; }
    .hint { margin: 0; font-size: var(--fs-xs); color: var(--ink-2); }
</style>
