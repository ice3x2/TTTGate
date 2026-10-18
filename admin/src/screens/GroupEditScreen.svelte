<script lang="ts">
    import {onMount} from 'svelte';
    import GroupsCtrl from '../controller/GroupsCtrl';
    import InvalidSession from '../controller/InvalidSession';
    import {DEFAULT_GROUP_ATTRIBUTES, type Group, type GroupAttributes, type TunnelProtocolName} from '../controller/Types';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Checkbox from '../ui/Checkbox.svelte';
    import Field from '../ui/Field.svelte';
    import Modal from '../ui/Modal.svelte';
    import NumberInput from '../ui/NumberInput.svelte';
    import Select from '../ui/Select.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {toast} from '../ui/toast';
    import {navigate} from '../router';
    import {useSession} from '../shell/session';

    // U3-04: #/groups/new 와 #/groups/<id>. 정합성 규칙은 서버(422)에 맡기고, HTTP rewrite 가 꺼지면 리라이트 권한을 끄는 것만 여기서 한다.
    let {param}: {param: string} = $props();

    const session = useSession();
    const isNew = $derived(param === 'new');
    const isSuperuserGroup = $derived(param === 'system:superuser');
    const isDefaultGroup = $derived(param === 'default');
    const readOnly = $derived(isSuperuserGroup);

    type Section = GroupAttributes['admin_ui_section_access'][number];
    type Permission = keyof GroupAttributes['http_tunnel_rewrite_permissions'];

    const HOUR_MS = 3_600_000;
    const CRUD = [{value: 'none', label: 'None'}, {value: 'read_only', label: 'Read only'}, {value: 'full', label: 'Full'}];
    const PROTOCOLS: Array<{value: TunnelProtocolName; label: string}> = [
        {value: 'TCP', label: 'TCP'}, {value: 'HTTP', label: 'HTTP'}, {value: 'HTTPS', label: 'HTTPS'}, {value: 'HTTP_REWRITE', label: 'HTTP rewrite'}];
    const PERMISSIONS: Array<{value: Permission; label: string}> = [
        {value: 'cors', label: 'CORS'}, {value: 'host', label: 'Host'}, {value: 'header', label: 'Headers'}, {value: 'body', label: 'Body'}];
    const RATE_LIMITS = [{value: 'unlimited', label: 'Unlimited'}, {value: '1MB/s', label: '1 MB/s'},
        {value: '10MB/s', label: '10 MB/s'}, {value: '100MB/s', label: '100 MB/s'}];
    const SECTIONS: Array<{value: Section; label: string}> = [
        {value: 'tunnels', label: 'Tunnels'}, {value: 'my_audit', label: 'My audit log'}, {value: 'my_profile', label: 'My profile'}, {value: 'my_sessions', label: 'My sessions'}];
    const VISIBILITY = [{value: 'private', label: 'Private'}, {value: 'group_read', label: 'Readable by group'}];

    const clone = (attrs: GroupAttributes): GroupAttributes => JSON.parse(JSON.stringify(attrs));
    const snapshot = (name: string, attrs: GroupAttributes): string => JSON.stringify({name, attrs});

    let trustedClients = $state<Array<{clientId: string; displayName?: string}>>([]);
    let group = $state<Group | undefined>();
    let name = $state('');
    let attrs = $state<GroupAttributes>(clone(DEFAULT_GROUP_ATTRIBUTES));
    let durationHours = $state<number | null>(0);
    let loadedSnapshot = $state(snapshot('', DEFAULT_GROUP_ATTRIBUTES));
    let nameError = $state('');
    // 빈 한도 칸 오류. 빈칸을 0(무제한)으로 저장하면 운영자 모르게 제한이 풀린다(U3 그룹 한도).
    let limitErrors = $state<{count?: string; duration?: string; concurrent?: string}>({});
    let formError = $state('');
    let pending = $state(false);
    let deleteOpen = $state(false);

    const dirty = $derived(snapshot(name, attrs) !== loadedSnapshot);
    const rewriteAllowed = $derived(attrs.allowed_protocols.includes('HTTP_REWRITE'));

    // HTTP rewrite 가 빠지면 리라이트 권한은 모두 false 여야 한다(서버 정합성 규칙). 이것만 클라이언트가 맞춘다.
    $effect(() => {
        if(rewriteAllowed) return;
        const permissions = attrs.http_tunnel_rewrite_permissions;
        if(permissions.cors || permissions.host || permissions.header || permissions.body) {
            attrs.http_tunnel_rewrite_permissions = {cors: false, host: false, header: false, body: false};
        }
    });

    // 불러온 속성. 저장 때 바뀐 키만 보낸다(#152 — 전체를 덮어쓰면 다른 운영자의 변경이 되돌아간다).
    let loadedAttrs = $state<GroupAttributes>(clone(DEFAULT_GROUP_ATTRIBUTES));
    const changedAttributes = (next: GroupAttributes): Partial<GroupAttributes> => Object.fromEntries(
        Object.entries(next).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify((loadedAttrs as Record<string, unknown>)[key]))) as Partial<GroupAttributes>;

    const fill = (value: Group) => {
        group = value;
        name = value.name;
        attrs = clone({...DEFAULT_GROUP_ATTRIBUTES, ...value.attributes});
        loadedAttrs = clone(attrs);
        // 시간 단위로 나누어떨어지지 않는 값(예: 1.5 시간)도 그대로 보인다. 내림하면 저장 때 정책이 바뀐다.
        durationHours = attrs.max_tunnel_duration_ms / HOUR_MS;
        loadedSnapshot = snapshot(name, attrs);
    };

    /** 표 순서를 지키며 값을 넣거나 뺀다. 표에 없는 기존 값(예: 등록이 지워진 신뢰 클라이언트)은 뒤에 그대로 둔다. */
    const toggled = <T,>(order: ReadonlyArray<T>, current: ReadonlyArray<T>, value: T, on: boolean): T[] =>
        [...order.filter((item) => item === value ? on : current.includes(item)), ...current.filter((item) => !order.includes(item))];

    const setDuration = (value: number | null) => {
        durationHours = value;
        if(value !== null) attrs.max_tunnel_duration_ms = value * HOUR_MS;
    };

    /** 한도 칸이 비었는지 본다. 빈칸은 저장하지 않는다 — 0 은 무제한이라 직접 넣어야 한다. */
    const emptyLimitErrors = (): {count?: string; duration?: string; concurrent?: string} => ({
        ...(attrs.max_tunnel_count == null ? {count: 'Enter a number. 0 disables tunnel creation.'} : {}),
        ...(durationHours == null ? {duration: 'Enter a number. 0 means unlimited.'} : {}),
        ...(attrs.max_concurrent_connections == null ? {concurrent: 'Enter a number. 0 means unlimited.'} : {})
    });

    /** 포트 범위의 null 은 그대로 보내 서버 422 를 받는다. 기간은 setDuration 이 attrs 에 이미 반영한다. */
    const normalized = (): GroupAttributes => clone(attrs);

    const run = async (task: () => Promise<void>): Promise<void> => {
        pending = true;
        try {
            await task();
        } catch(error) {
            // adminRequest 는 네트워크 오류를 실패 값으로 돌려준다. 여기에는 InvalidSession 과 예상하지 못한 예외만 온다.
            if(error instanceof InvalidSession) session.invalidate();
            else toast.push({tone: 'alarm', message: 'Unable to connect to the server.'});
        } finally {
            pending = false;
        }
    };

    const reload = async (id: string): Promise<void> => {
        const result = await GroupsCtrl.instance.get(id);
        if(result.success) fill(result.group);
        else navigate('#/groups');
    };

    const submit = (e: SubmitEvent) => {
        e.preventDefault();
        if(readOnly || pending) return;
        formError = '';
        nameError = name.trim() === '' ? 'Enter a group name.' : '';
        limitErrors = emptyLimitErrors();
        if(nameError || Object.keys(limitErrors).length > 0) return;
        void run(async () => {
            const attributes = normalized();
            if(isNew) {
                const result = await GroupsCtrl.instance.create({name, attributes});
                if(result.success) navigate('#/groups/' + result.group.id);
                else formError = result.message;
                return;
            }
            if(!group) return;
            const id = group.id;
            const changed = changedAttributes(attributes);
            const patch: {name?: string; attributes?: Partial<GroupAttributes>; expectedRevision: number} = {expectedRevision: group.revision ?? 0};
            if(Object.keys(changed).length > 0) patch.attributes = changed;
            if(!isDefaultGroup && name !== group.name) patch.name = name;
            const result = await GroupsCtrl.instance.update(id, patch);
            if(!result.success) {
                formError = result.status === 409 && result.code === 'group_revision_conflict'
                    ? 'Someone else changed this group. Reload to see the latest values.' : result.message;
                return;
            }
            toast.push({tone: 'pulse', message: 'Group saved.'});
            await reload(id);
        });
    };

    const remove = () => {
        deleteOpen = false;
        void run(async () => {
            if(!group) return;
            const result = await GroupsCtrl.instance.remove(group.id);
            if(result.success) {
                toast.push({tone: 'pulse', message: 'Group deleted.'});
                navigate('#/groups');
            } else if(result.code === 'group_not_empty') {
                toast.push({tone: 'alarm', message: 'Move the members to another group first.'});
            } else {
                toast.push({tone: 'alarm', message: result.message});
            }
        });
    };

    onMount(() => {
        void run(async () => {
            const loaded = await GroupsCtrl.instance.trustedClients();
            if(loaded.success) {
                trustedClients = loaded.trustedClients;
            } else {
                toast.push({tone: 'alarm', message: 'Could not load trusted clients.'});
                trustedClients = [];
            }
            if(!isNew) await reload(param);
        });
    });
</script>

<form onsubmit={submit} novalidate style="display: flex; flex-direction: column; gap: var(--s-4);">
    {#if readOnly}
        <p id="group-readonly-note">Superusers are not limited by attributes.</p>
    {/if}
    <Field label="Name" for="group-name" error={nameError || undefined}>
        <TextInput id="group-name" disabled={readOnly || isDefaultGroup} invalid={nameError !== ''} bind:value={name} />
    </Field>

    <Card label="Tunnel permissions">
        <div style="display: flex; flex-direction: column; gap: var(--s-4);">
            {#if formError}
                <p id="group-form-error" role="alert">{formError}</p>
            {/if}
            <Field label="Tunnel access" for="group-attr-tunnel_crud">
                <Select id="group-attr-tunnel_crud" options={CRUD} disabled={readOnly}
                    bind:value={() => attrs.tunnel_crud, (value) => (attrs.tunnel_crud = value as GroupAttributes['tunnel_crud'])} />
            </Field>
            <Field label="Max tunnels" hint="0 disables tunnel creation" for="group-attr-max_tunnel_count" error={limitErrors.count}>
                <NumberInput id="group-attr-max_tunnel_count" min={0} max={1000} step={1} disabled={readOnly}
                    bind:value={() => attrs.max_tunnel_count, (value) => (attrs.max_tunnel_count = value as number)} />
            </Field>
            <Field label="Max tunnel duration (hours)" hint="0 = unlimited" for="group-attr-max_tunnel_duration_ms" error={limitErrors.duration}>
                <NumberInput id="group-attr-max_tunnel_duration_ms" min={0} max={8760} step={1} disabled={readOnly}
                    bind:value={() => durationHours, setDuration} />
            </Field>
            <Field label="Allowed port ranges">
                <div style="display: flex; flex-direction: column; gap: var(--s-2);">
                    {#each attrs.allowed_port_range as range, i (i)}
                        <div data-range-index={i} style="display: flex; gap: var(--s-2); align-items: center;">
                            <NumberInput id={`group-attr-allowed_port_range-${i}-from`} min={1} max={65535} disabled={readOnly}
                                bind:value={() => range.from, (value) => (range.from = value as number)} />
                            <NumberInput id={`group-attr-allowed_port_range-${i}-to`} min={1} max={65535} disabled={readOnly}
                                bind:value={() => range.to, (value) => (range.to = value as number)} />
                            <Button size="sm" disabled={readOnly}
                                onclick={() => (attrs.allowed_port_range = attrs.allowed_port_range.filter((_, index) => index !== i))}>Remove</Button>
                        </div>
                    {:else}
                        <p>No ports are allowed.</p>
                    {/each}
                    <div><Button size="sm" disabled={readOnly}
                        onclick={() => (attrs.allowed_port_range = [...attrs.allowed_port_range, {from: 1, to: 65535}])}>Add range</Button></div>
                </div>
            </Field>
            <Field label="Allowed protocols">
                <div style="display: flex; flex-wrap: wrap; gap: var(--s-4);">
                    {#each PROTOCOLS as protocol (protocol.value)}
                        <Checkbox id={`group-attr-allowed_protocols-${protocol.value}`} label={protocol.label} disabled={readOnly}
                            bind:checked={() => attrs.allowed_protocols.includes(protocol.value),
                                (on) => (attrs.allowed_protocols = toggled(PROTOCOLS.map((p) => p.value), attrs.allowed_protocols, protocol.value, on))} />
                    {/each}
                </div>
            </Field>
            <Field label="HTTP rewrite permissions">
                <div style="display: flex; flex-wrap: wrap; gap: var(--s-4);">
                    {#each PERMISSIONS as permission (permission.value)}
                        <Checkbox id={`group-attr-http_tunnel_rewrite_permissions-${permission.value}`} label={permission.label}
                            disabled={readOnly || !rewriteAllowed}
                            bind:checked={() => attrs.http_tunnel_rewrite_permissions[permission.value],
                                (on) => (attrs.http_tunnel_rewrite_permissions[permission.value] = on)} />
                    {/each}
                </div>
            </Field>
            <Field label="Allowed trusted clients">
                <div style="display: flex; flex-wrap: wrap; gap: var(--s-4);">
                    {#each trustedClients as client (client.clientId)}
                        <Checkbox id={`group-attr-allowed_trusted_clients-${client.clientId}`} label={client.displayName ?? client.clientId} disabled={readOnly}
                            bind:checked={() => attrs.allowed_trusted_clients.includes(client.clientId),
                                (on) => (attrs.allowed_trusted_clients = toggled(trustedClients.map((c) => c.clientId), attrs.allowed_trusted_clients, client.clientId, on))} />
                    {:else}
                        <p>No trusted clients are registered.</p>
                    {/each}
                </div>
            </Field>
        </div>
    </Card>

    <Card label="Limits">
        <div style="display: flex; flex-direction: column; gap: var(--s-4);">
            <Field label="Max concurrent connections" hint="0 = unlimited" for="group-attr-max_concurrent_connections" error={limitErrors.concurrent}>
                <NumberInput id="group-attr-max_concurrent_connections" min={0} max={100000} step={1} disabled={readOnly}
                    bind:value={() => attrs.max_concurrent_connections, (value) => (attrs.max_concurrent_connections = value as number)} />
            </Field>
            <Field label="Bandwidth" for="group-attr-rate_limit">
                <Select id="group-attr-rate_limit" options={RATE_LIMITS} disabled={readOnly}
                    bind:value={() => attrs.rate_limit, (value) => (attrs.rate_limit = value as GroupAttributes['rate_limit'])} />
            </Field>
        </div>
    </Card>

    <Card label="Visibility">
        <div style="display: flex; flex-direction: column; gap: var(--s-4);">
            <Field label="Admin UI sections">
                <div style="display: flex; flex-wrap: wrap; gap: var(--s-4);">
                    {#each SECTIONS as section (section.value)}
                        <Checkbox id={`group-attr-admin_ui_section_access-${section.value}`} label={section.label} disabled={readOnly}
                            bind:checked={() => attrs.admin_ui_section_access.includes(section.value),
                                (on) => (attrs.admin_ui_section_access = toggled(SECTIONS.map((s) => s.value), attrs.admin_ui_section_access, section.value, on))} />
                    {/each}
                </div>
            </Field>
            <Field label="Tunnel visibility" for="group-attr-tunnel_visibility">
                <Select id="group-attr-tunnel_visibility" options={VISIBILITY} disabled={readOnly}
                    bind:value={() => attrs.tunnel_visibility, (value) => (attrs.tunnel_visibility = value as GroupAttributes['tunnel_visibility'])} />
            </Field>
        </div>
    </Card>

    {#if !readOnly}
        <!-- 하단 고정 바. 흐름 안의 sticky 라서 폼 마지막 입력을 덮지 않는다(TunnelEditScreen 과 같은 배치). -->
        <div style="position: sticky; bottom: 0; z-index: 40; display: flex; flex-wrap: wrap; gap: var(--s-3); justify-content: flex-end;
            padding: var(--s-3) 0; margin-top: var(--s-4); background: var(--bg-1); border-top: 1px solid var(--line-0);">
            {#if isNew}
                <Button variant="primary" type="submit" disabled={pending}>Create group</Button>
            {:else}
                {#if group && !group.system}
                    <Button variant="danger" disabled={pending} onclick={() => (deleteOpen = true)}>Delete</Button>
                {/if}
                <Button variant="primary" type="submit" disabled={pending || !group || !dirty}>Save</Button>
            {/if}
        </div>
    {/if}
</form>

<Modal bind:open={deleteOpen} title="Delete group">
    Delete {group?.name}? This cannot be undone.
    {#snippet footer()}
        <Button onclick={() => (deleteOpen = false)}>Cancel</Button>
        <Button variant="danger" onclick={remove}>Delete group</Button>
    {/snippet}
</Modal>
