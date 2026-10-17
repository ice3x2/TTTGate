<script lang="ts">
    import {onMount} from 'svelte';
    import InvalidSession from '../controller/InvalidSession';
    import MeCtrl from '../controller/MeCtrl';
    import SessionsCtrl from '../controller/SessionsCtrl';
    import UsersCtrl from '../controller/UsersCtrl';
    import type {SessionView} from '../controller/Types';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Chip from '../ui/Chip.svelte';
    import Field from '../ui/Field.svelte';
    import Modal from '../ui/Modal.svelte';
    import Select from '../ui/Select.svelte';
    import {toast} from '../ui/toast';
    import {me} from '../me';
    import {useSession} from '../shell/session';
    import {formatLocal, relativeTime} from '../util/relativeTime';

    // U4-06: #/sessions. 슈퍼유저는 전체 세션을 보고 끊는다. 일반 유저는 본인 세션과 "다른 기기 로그아웃" 만 있다.
    const session = useSession();
    const POLL_MS = 10_000;
    const UA_LIMIT = 48;

    const superuser = $derived($me?.user.role === 'superuser');

    let sessions = $state<SessionView[]>([]);
    let loaded = $state(false);
    let now = $state(Date.now());
    let filterUser = $state('');
    let pending = $state(false);
    let endTarget = $state<SessionView | undefined>();
    let endOpen = $state(false);
    let endAllOpen = $state(false);

    const visible = $derived(superuser && filterUser !== '' ? sessions.filter((entry) => entry.userId === filterUser) : sessions);
    // 필터 선택지는 사용자 목록에서 만든다(세션이 모두 끊겨도 고른 사용자가 선택지에 남는다).
    let userOptions = $state<Array<{value: string; label: string}>>([{value: '', label: 'All users'}]);
    const filterName = $derived(userOptions.find((option) => option.value === filterUser)?.label ?? '');
    const selfSelected = $derived(filterUser !== '' && filterUser === $me?.user.id);

    const shortAgent = (agent: string): string => agent.length > UA_LIMIT ? agent.slice(0, UA_LIMIT) + '…' : agent;

    /** 목록을 다시 읽는다. 폴링(quiet)이면 InvalidSession 외 오류는 알리지 않고 다음 주기에 다시 시도한다. */
    const load = async (quiet = false): Promise<void> => {
        try {
            const result = superuser ? await SessionsCtrl.instance.list() : await MeCtrl.instance.sessions();
            now = Date.now();
            if(result.success) {
                sessions = result.sessions;
                loaded = true;
                // 필터로 고른 사용자의 세션이 모두 사라져도 필터는 유지한다.
            } else if(!quiet) {
                toast.push({tone: 'alarm', message: result.message});
            }
        } catch(error) {
            if(error instanceof InvalidSession) session.invalidate();
            else if(!quiet) toast.push({tone: 'alarm', message: 'Unable to connect to the server.'});
        }
    };

    const run = async (task: () => Promise<void>): Promise<void> => {
        pending = true;
        try {
            await task();
        } catch(error) {
            if(error instanceof InvalidSession) session.invalidate();
            else toast.push({tone: 'alarm', message: 'Unable to connect to the server.'});
        } finally {
            pending = false;
        }
    };

    const askEnd = (entry: SessionView) => {
        endTarget = entry;
        endOpen = true;
    };

    const endOne = () => {
        endOpen = false;
        const target = endTarget;
        if(!target) return;
        void run(async () => {
            const result = await SessionsCtrl.instance.kill(target.id);
            if(!result.success) {
                // 이미 끝난 세션이면 목록이 낡았다. 다음 폴링을 기다리지 않고 다시 읽는다.
                toast.push({tone: 'alarm', message: result.message});
                await load();
                return;
            }
            if(result.self) {
                session.invalidate();
                return;
            }
            toast.push({tone: 'pulse', message: 'Session ended.'});
            await load();
        });
    };

    const endAll = () => {
        endAllOpen = false;
        const userId = filterUser;
        if(userId === '') return;
        void run(async () => {
            const result = await SessionsCtrl.instance.killAllForUser(userId);
            if(!result.success) {
                toast.push({tone: 'alarm', message: result.message});
                return;
            }
            if(result.self) {
                session.invalidate();
                return;
            }
            toast.push({tone: 'pulse', message: `Ended ${result.removed} session(s).`});
            await load();
        });
    };

    const logoutOthers = () => run(async () => {
        const result = await MeCtrl.instance.logoutOthers();
        if(!result.success) {
            toast.push({tone: 'alarm', message: result.message});
            return;
        }
        toast.push({tone: 'pulse', message: `Signed out ${result.removed} other device(s).`});
        await load();
    });

    onMount(() => {
        if(superuser) {
            void run(async () => {
                const users = await UsersCtrl.instance.list();
                if(users.success) userOptions = [{value: '', label: 'All users'}, ...users.users.map((user) => ({value: user.id, label: user.username}))];
            });
        }
        void load();
        // 모달이 열려 있어도 목록만 바꾸고 모달은 그대로 둔다.
        const timer = setInterval(() => { void load(true); }, POLL_MS);
        return () => clearInterval(timer);
    });
</script>

<div style="display: flex; flex-direction: column; gap: var(--s-4);">
    {#if superuser}
        <div style="display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: flex-end;">
            <Field label="User" for="sessions-filter-user">
                <Select id="sessions-filter-user" options={userOptions} bind:value={filterUser} />
            </Field>
            <span id="sessions-end-all-user"><Button variant="danger" disabled={filterUser === '' || pending} onclick={() => (endAllOpen = true)}>End all for user</Button></span>
        </div>
    {:else}
        <div><span id="sessions-logout-others"><Button disabled={pending} onclick={() => { void logoutOthers(); }}>Sign out other devices</Button></span></div>
    {/if}

    {#if loaded && visible.length === 0}
        <p id="sessions-empty">No active sessions.</p>
    {/if}
    <ul id="sessions-list" style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-3);">
        {#each visible as entry (entry.id)}
            <li class="session-row" data-session-id={entry.id}>
                <Card compact>
                    <div style="display: flex; gap: var(--s-3); align-items: flex-start; justify-content: space-between;">
                        <div style="min-width: 0; display: flex; flex-direction: column; gap: var(--s-1);">
                            <div style="display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center;">
                                <span class="session-user">{entry.username}</span>
                                {#if entry.current}<Chip tone="signal">this device</Chip>{/if}
                            </div>
                            <div class="mono" style="color: var(--ink-2);">started {formatLocal(entry.createdAt, false)} · last seen {relativeTime(entry.lastSeenAt, now)}</div>
                            <div class="mono" style="color: var(--ink-2); overflow-wrap: anywhere;">{entry.ip} · <span title={entry.userAgent}>{shortAgent(entry.userAgent)}</span></div>
                        </div>
                        {#if superuser}
                            <Button variant="danger" size="sm" class="session-end" disabled={pending} onclick={() => askEnd(entry)}>End</Button>
                        {/if}
                    </div>
                </Card>
            </li>
        {/each}
    </ul>
</div>

<Modal bind:open={endOpen} title="End session" class="end-session-modal">
    {endTarget?.current ? 'End this session? You will be signed out.' : `End this session for ${endTarget?.username ?? ''}?`}
    {#snippet footer()}
        <Button onclick={() => (endOpen = false)}>Cancel</Button>
        <span id="confirm-end"><Button variant="danger" onclick={endOne}>End</Button></span>
    {/snippet}
</Modal>
<Modal bind:open={endAllOpen} title="End all sessions" class="end-all-modal">
    {selfSelected ? `End all sessions for ${filterName}? You will be signed out.` : `End all sessions for ${filterName}?`}
    {#snippet footer()}
        <Button onclick={() => (endAllOpen = false)}>Cancel</Button>
        <span id="confirm-end-all"><Button variant="danger" onclick={endAll}>End all</Button></span>
    {/snippet}
</Modal>
