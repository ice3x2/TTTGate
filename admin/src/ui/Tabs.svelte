<script lang="ts">
    let {
        items,
        active = $bindable(''),
        class: className = '',
        onchange,
    }: {
        items: Array<{id: string; label: string}>;
        active?: string;
        class?: string;
        onchange?: (id: string) => void;
    } = $props();

    // 선택 탭 하나만 Tab 순서에 둔다(roving tabindex). 선택이 목록에 없으면 첫 탭이 받는다.
    const focusable = $derived(items.some((item) => item.id === active) ? active : items[0]?.id);

    // WAI-ARIA Tabs 패턴: 화살표는 끝에서 반대쪽 끝으로 돌고, Home·End 는 양 끝으로 간다. 포커스와 함께 선택한다(이슈 188).
    // 수정키 조합(Alt+ArrowLeft 뒤로 가기 등)은 브라우저 몫으로 남긴다.
    function onkeydown(event: KeyboardEvent, index: number) {
        if(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const last = items.length - 1;
        const next = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
            : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
            : event.key === 'Home' ? 0
            : event.key === 'End' ? last
            : -1;
        if(next < 0) return;
        event.preventDefault();
        (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
        const id = items[next].id;
        if(active === id) return;
        active = id;
        onchange?.(id);
    }
</script>

<div class="tabs {className}" role="tablist">
    {#each items as item, index (item.id)}
        <button type="button" role="tab" class="tab {active === item.id ? 'active' : ''}"            tabindex={focusable === item.id ? 0 : -1} onkeydown={(event) => onkeydown(event, index)}
            aria-selected={active === item.id} onclick={() => { active = item.id; onchange?.(item.id); }}>
            {item.label}
        </button>
    {/each}
</div>

<style>
    .tabs{
        display:flex; gap: var(--s-6);
        border-bottom: 1px solid var(--line-1);
        margin-bottom: var(--s-5);
    }
    .tab{
        background: none; border: 0;
        font-family: var(--ff-ui);
        font-size: 13px; font-weight: 500;
        padding: var(--s-3) 0;
        color: var(--ink-2);
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        cursor: pointer;
        transition: color var(--dur-2) var(--ease-out),
                    border-color var(--dur-2) var(--ease-out);
        display:inline-flex; align-items:center; gap: var(--s-2);
    }
    .tab:hover{ color: var(--ink-0); }
    .tab.active{
        color: var(--ink-0);
        border-bottom-color: var(--signal);
    }
</style>
