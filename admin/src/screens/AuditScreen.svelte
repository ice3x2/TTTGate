<script lang="ts">
    import {onMount} from 'svelte';
    import AuditCtrl from '../controller/AuditCtrl';
    import InvalidSession from '../controller/InvalidSession';
    import UsersCtrl from '../controller/UsersCtrl';
    import type {AuditEventView, AuditQueryInput} from '../controller/Types';
    import Badge from '../ui/Badge.svelte';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Chip from '../ui/Chip.svelte';
    import Field from '../ui/Field.svelte';
    import Loading from '../ui/Loading.svelte';
    import Select from '../ui/Select.svelte';
    import Tabs from '../ui/Tabs.svelte';
    import {toast} from '../ui/toast';
    import {me} from '../me';
    import {useSession} from '../shell/session';
    import {formatLocal} from '../util/relativeTime';

    // U4-06: #/audit. 슈퍼유저는 전체, 일반 유저는 서버가 본인 이벤트만 준다(클라이언트 필터 없음). 50 건씩 읽는다.
    const session = useSession();
    const LIMIT = 50;
    const RANGES = [{id: '24h', label: '24h'}, {id: '7d', label: '7d'}, {id: '30d', label: '30d'}, {id: 'all', label: 'All'}];
    const RANGE_MS: Record<string, number> = {'24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000};
    const OUTCOMES = [{value: '', label: 'All outcomes'}, {value: 'success', label: 'Success'}, {value: 'failure', label: 'Failure'}];

    const superuser = $derived($me?.user.role === 'superuser');

    let typeOptions = $state<Array<{value: string; label: string}>>([{value: '', label: 'All types'}]);
    let userOptions = $state<Array<{value: string; label: string}>>([{value: '', label: 'All users'}]);
    let type = $state('');
    let userId = $state('');
    let outcome = $state('');
    let range = $state('7d');
    let events = $state<AuditEventView[]>([]);
    let nextCursor = $state<string | undefined>();
    let loading = $state(false);
    let expanded = $state<Record<number, boolean>>({});
    // 늦게 도착한 앞선 응답이 새 필터의 결과를 덮지 않게 요청마다 번호를 매긴다.
    let generation = 0;
    // Load more 는 처음 조회한 조건(from 포함)에 커서만 바꿔 다시 쓴다.
    let activeQuery: AuditQueryInput = {};

    const failed = (error: unknown) => {
        if(error instanceof InvalidSession) session.invalidate();
        else toast.push({tone: 'alarm', message: 'Failed to load audit events.'});
    };

    const query = (): AuditQueryInput => ({
        type: type || undefined,
        userId: superuser ? (userId || undefined) : undefined,
        outcome: (outcome || undefined) as AuditQueryInput['outcome'],
        from: range === 'all' ? undefined : Date.now() - RANGE_MS[range],
        limit: LIMIT,
    });

    /** 필터가 바뀌면 커서를 버리고 처음부터 읽는다. */
    const reload = async () => {
        const mine = ++generation;
        events = [];
        nextCursor = undefined;
        expanded = {};
        loading = true;
        activeQuery = query();
        try {
            const result = await AuditCtrl.instance.list(activeQuery);
            if(mine !== generation) return;
            if(result.success) {
                events = result.events;
                nextCursor = result.nextCursor;
            } else {
                toast.push({tone: 'alarm', message: 'Failed to load audit events.'});
            }
        } catch(error) {
            failed(error);
        } finally {
            if(mine === generation) loading = false;
        }
    };

    const loadMore = async () => {
        if(!nextCursor) return;
        const mine = generation;
        loading = true;
        try {
            const result = await AuditCtrl.instance.list({...activeQuery, cursor: nextCursor});
            if(mine !== generation) return;
            if(result.success) {
                events = [...events, ...result.events];
                nextCursor = result.nextCursor;
            } else {
                toast.push({tone: 'alarm', message: 'Failed to load audit events.'});
            }
        } catch(error) {
            failed(error);
        } finally {
            if(mine === generation) loading = false;
        }
    };

    onMount(async () => {
        try {
            const types = await AuditCtrl.instance.types();
            if(types.success) typeOptions = [{value: '', label: 'All types'}, ...types.types.map((value) => ({value, label: value}))];
            if(superuser) {
                const users = await UsersCtrl.instance.list();
                if(users.success) userOptions = [{value: '', label: 'All users'}, ...users.users.map((user) => ({value: user.id, label: user.username}))];
            }
        } catch(error) {
            // 선택지를 못 읽어도 목록은 읽는다. 세션이 끝났으면 여기서 멈춘다.
            failed(error);
            if(error instanceof InvalidSession) return;
        }
        await reload();
    });
</script>

<div style="display: flex; flex-direction: column; gap: var(--s-4);">
    <section id="audit-filters">
        <Card compact>
            <div style="display: flex; flex-direction: column; gap: var(--s-3);">
                <Field label="Type" for="audit-filter-type">
                    <Select id="audit-filter-type" options={typeOptions} bind:value={type} onchange={() => { void reload(); }} />
                </Field>
                {#if superuser}
                    <Field label="User" for="audit-filter-user">
                        <Select id="audit-filter-user" options={userOptions} bind:value={userId} onchange={() => { void reload(); }} />
                    </Field>
                {/if}
                <Field label="Outcome" for="audit-filter-outcome">
                    <Select id="audit-filter-outcome" options={OUTCOMES} bind:value={outcome} onchange={() => { void reload(); }} />
                </Field>
                <div id="audit-range"><Tabs items={RANGES} bind:active={range} onchange={() => { void reload(); }} /></div>
            </div>
        </Card>
    </section>

    {#if !loading && events.length === 0}
        <p id="audit-empty">No events in this range.</p>
    {/if}
    <ul id="audit-list" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-3);">
        {#each events as event, i (i)}
            <li class="audit-event" data-type={event.type} data-outcome={event.outcome}>
                <Card compact>
                    <button type="button" class="audit-toggle" aria-expanded={expanded[i] === true}
                        style="display: block; width: 100%; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;"
                        onclick={() => (expanded[i] = !expanded[i])}>
                        <div style="display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center;">
                            <span class="mono audit-time">{formatLocal(event.at, true)}</span>
                            <Badge tone={event.outcome === 'success' ? 'pulse' : 'alarm'}>{event.outcome}</Badge>
                            <Chip>{event.type}</Chip>
                        </div>
                        <div style="margin-top: var(--s-1);"><span class="audit-summary">{event.summary}</span></div>
                        <div style="margin-top: var(--s-1); color: var(--ink-2);">
                            <span class="mono audit-meta">@{event.actor.username ?? event.actor.userId} · {event.target ? event.target.kind + ':' + event.target.id : '—'} · {event.ip ?? '—'}</span>
                        </div>
                    </button>
                    {#if expanded[i]}
                        <pre class="mono audit-detail" style="margin: var(--s-2) 0 0; white-space: pre-wrap; word-break: break-all;">{JSON.stringify(event.detail ?? {}, null, 2)}</pre>
                    {/if}
                </Card>
            </li>
        {/each}
    </ul>
    {#if nextCursor}
        <div><span id="audit-load-more"><Button disabled={loading} onclick={() => { void loadMore(); }}>Load more</Button></span></div>
    {/if}
    {#if loading}<Loading />{/if}
</div>
