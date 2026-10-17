<script lang="ts">
    import {onMount} from 'svelte';
    import InvalidSession from '../controller/InvalidSession';
    import GroupsCtrl from '../controller/GroupsCtrl';
    import UsersCtrl from '../controller/UsersCtrl';
    import type {ApiFailure, Role, UserStatus, UserView} from '../controller/Types';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Checkbox from '../ui/Checkbox.svelte';
    import Field from '../ui/Field.svelte';
    import Modal from '../ui/Modal.svelte';
    import Select from '../ui/Select.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {toast} from '../ui/toast';
    import {loadMe, me} from '../me';
    import {navigate} from '../router';
    import {defaultHash} from '../shell/nav';
    import {useSession} from '../shell/session';
    import TempPasswordModal from './parts/TempPasswordModal.svelte';

    // U3-03: #/users/new 와 #/users/<id>. 역할이 superuser 면 서버가 그룹을 정하므로 groupId 를 보내지 않는다.
    let {param}: {param: string} = $props();

    const session = useSession();
    const isNew = $derived(param === 'new');

    const ROLES = [{value: 'superuser', label: 'Superuser'}, {value: 'regular', label: 'Regular'}];
    const STATUSES = [{value: 'active', label: 'Active'}, {value: 'disabled', label: 'Disabled'}];
    const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

    let groups = $state<Array<{value: string; label: string}>>([]);
    let loaded = $state<UserView | undefined>();
    let username = $state('');
    let displayName = $state('');
    let role = $state<Role>('regular');
    let groupId = $state('default');
    let status = $state<UserStatus>('active');
    let tempAuto = $state(true);
    let tempPassword = $state('');
    let errors = $state<{username?: string; tempPassword?: string}>({});
    let formError = $state('');
    let pending = $state(false);

    let resetOpen = $state(false);
    let deleteOpen = $state(false);
    let tempOpen = $state(false);
    let tempUsername = $state('');
    let tempValue = $state('');
    let afterTemp: () => void = () => {};

    // 표시 이름을 비우는 것은 변경으로 보지 않는다(요청에서 빼므로 저장해도 바뀌지 않는다).
    const dirty = $derived(loaded !== undefined && ((displayName !== loaded.displayName && displayName !== '') || role !== loaded.role
        || status !== loaded.status || (role === 'regular' && groupId !== loaded.groupId)));

    const fill = (user: UserView) => {
        loaded = user;
        username = user.username;
        displayName = user.displayName;
        role = user.role;
        groupId = user.groupId;
        status = user.status;
    };

    /** 요청 하나를 감싼다. 세션이 끝났으면 로그인 화면으로 보낸다(InvalidSession 외 예외는 연결 실패로 알린다). */
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

    const reload = async (id: string): Promise<void> => {
        const result = await UsersCtrl.instance.get(id);
        if(result.success) fill(result.user);
        else navigate('#/users');
    };

    const onRole = (value: string) => {
        // 슈퍼유저를 일반 유저로 내리면 그룹이 system:superuser 로 남아 있으므로 Default 를 고른다.
        if(value === 'regular' && groupId === 'system:superuser') groupId = 'default';
    };

    const failureMessage = (failure: ApiFailure): string => {
        if(failure.code === 'username_taken') return 'That username is already in use.';
        if(failure.code === 'last_superuser') return 'At least one active superuser must remain.';
        return failure.message;
    };

    const validate = (): {username?: string; tempPassword?: string} => {
        if(!isNew) return {};
        if(!USERNAME_PATTERN.test(username)) return {username: 'Username must be 3–32 chars, lowercase letters, digits, . _ -'};
        if(!tempAuto && tempPassword.length < 8) return {tempPassword: 'Use at least 8 characters.'};
        return {};
    };

    const showTemp = (name: string, password: string, done: () => void) => {
        tempUsername = name;
        tempValue = password;
        afterTemp = done;
        tempOpen = true;
    };

    const create = () => run(async () => {
        const result = await UsersCtrl.instance.create({
            username, displayName: displayName === '' ? undefined : displayName, role,
            groupId: role === 'regular' ? groupId : undefined, temporaryPassword: tempAuto ? undefined : tempPassword,
        });
        if(!result.success) {
            formError = failureMessage(result);
            return;
        }
        tempPassword = '';
        const id = result.user.id;
        showTemp(result.user.username, result.temporaryPassword, () => navigate('#/users/' + id));
    });

    const save = () => run(async () => {
        if(!loaded) return;
        const before = loaded;
        const patch: {displayName?: string; role?: Role; status?: UserStatus; groupId?: string} = {};
        if(displayName !== before.displayName && displayName !== '') patch.displayName = displayName;
        if(role !== before.role) patch.role = role;
        if(status !== before.status) patch.status = status;
        // 슈퍼유저는 서버가 그룹을 정한다. 일반 유저로 내릴 때는 그룹을 반드시 보낸다.
        if(role === 'regular' && (groupId !== before.groupId || before.role === 'superuser')) patch.groupId = groupId;
        const result = await UsersCtrl.instance.update(before.id, patch);
        if(!result.success) {
            formError = failureMessage(result);
            return;
        }
        toast.push({tone: 'pulse', message: 'User saved.'});
        // 자기 자신을 바꿨으면 권한(sections)이 달라졌을 수 있다. me 를 다시 읽고, 사용자 관리 권한이 없어졌으면
        // 403 을 받는 재조회 대신 새 기본 화면으로 간다.
        if(before.id === $me?.user.id) {
            const principal = await loadMe();
            if(principal && !principal.sections.includes('users')) {
                navigate(defaultHash(principal.sections));
                return;
            }
        }
        await reload(before.id);
    });

    const submit = (e: SubmitEvent) => {
        e.preventDefault();
        if(pending) return;
        formError = '';
        errors = validate();
        if(Object.keys(errors).length > 0) return;
        void (isNew ? create() : save());
    };

    const resetPassword = () => {
        resetOpen = false;
        void run(async () => {
            if(!loaded) return;
            const id = loaded.id;
            const result = await UsersCtrl.instance.resetPassword(id);
            if(!result.success) {
                toast.push({tone: 'alarm', message: result.message});
                return;
            }
            showTemp(loaded.username, result.temporaryPassword, () => { void run(() => reload(id)); });
        });
    };

    const remove = () => {
        deleteOpen = false;
        void run(async () => {
            if(!loaded) return;
            const id = loaded.id;
            const result = await UsersCtrl.instance.remove(id);
            if(result.success && id === $me?.user.id) {
                // 자기 계정을 지웠으면 세션도 끝났다. 로그인 화면으로 간다.
                session.invalidate();
            } else if(result.success) {
                toast.push({tone: 'pulse', message: 'User deleted.'});
                navigate('#/users');
            } else if(result.code === 'user_owns_tunnels') {
                toast.push({tone: 'alarm', message: "Reassign this user's tunnels first."});
            } else {
                toast.push({tone: 'alarm', message: result.message});
            }
        });
    };

    onMount(() => {
        void run(async () => {
            const listed = await GroupsCtrl.instance.list();
            if(listed.success) {
                groups = listed.groups.filter((group) => group.id !== 'system:superuser').map((group) => ({value: group.id, label: group.name}));
            } else {
                toast.push({tone: 'alarm', message: listed.message});
            }
            if(!isNew) await reload(param);
        });
    });
</script>

<form id="user-form" onsubmit={submit} novalidate style="display: flex; flex-direction: column; gap: var(--s-4);">
    <Card>
        <div style="display: flex; flex-direction: column; gap: var(--s-4);">
            <Field label="Username" hint="3–32 chars, lowercase letters, digits, . _ -" for="user-username" error={errors.username}>
                <TextInput id="user-username" autocomplete="off" disabled={!isNew} invalid={errors.username !== undefined} bind:value={username} />
            </Field>
            <Field label="Display name" for="user-display-name">
                <TextInput id="user-display-name" bind:value={displayName} />
            </Field>
            <Field label="Role" for="user-role">
                <Select id="user-role" options={ROLES} bind:value={() => role, (value) => (role = value as Role)} onchange={onRole} />
            </Field>
            {#if role === 'regular'}
                <Field label="Group" for="user-group">
                    <Select id="user-group" options={groups} bind:value={groupId} />
                </Field>
            {/if}
            {#if !isNew}
                <Field label="Status" for="user-status">
                    <Select id="user-status" options={STATUSES} bind:value={() => status, (value) => (status = value as UserStatus)} />
                </Field>
            {/if}
        </div>
    </Card>
    {#if isNew}
        <Card label="Temporary password">
            <div style="display: flex; flex-direction: column; gap: var(--s-4);">
                <Checkbox id="user-temp-auto" label="Generate automatically" bind:checked={tempAuto} />
                {#if !tempAuto}
                    <Field label="Temporary password" hint="At least 8 characters." for="user-temp-password" error={errors.tempPassword}>
                        <TextInput id="user-temp-password" type="password" autocomplete="new-password"
                            invalid={errors.tempPassword !== undefined} bind:value={tempPassword} />
                    </Field>
                {/if}
            </div>
        </Card>
    {/if}
    {#if formError}
        <p id="user-form-error" role="alert">{formError}</p>
    {/if}
    <!-- 하단 고정 바. 흐름 안의 sticky 라서 폼 마지막 입력을 덮지 않는다(TunnelEditScreen 과 같은 배치). -->
    <div style="position: sticky; bottom: 0; z-index: 40; display: flex; flex-wrap: wrap; gap: var(--s-3); justify-content: flex-end;
        padding: var(--s-3) 0; margin-top: var(--s-4); background: var(--bg-1); border-top: 1px solid var(--line-0);">
        {#if isNew}
            <Button variant="primary" type="submit" disabled={pending}>Create user</Button>
        {:else}
            <Button disabled={pending || !loaded} onclick={() => (resetOpen = true)}>Reset password</Button>
            <Button variant="danger" disabled={pending || !loaded} onclick={() => (deleteOpen = true)}>Delete</Button>
            <Button variant="primary" type="submit" disabled={pending || !dirty}>Save</Button>
        {/if}
    </div>
</form>

<Modal bind:open={resetOpen} title="Reset password">
    Issue a new temporary password for @{loaded?.username}? Their current sessions will be signed out.
    {#snippet footer()}
        <Button onclick={() => (resetOpen = false)}>Cancel</Button>
        <Button variant="primary" onclick={resetPassword}>Issue password</Button>
    {/snippet}
</Modal>
<Modal bind:open={deleteOpen} title="Delete user">
    Delete @{loaded?.username}? This cannot be undone.
    {#snippet footer()}
        <Button onclick={() => (deleteOpen = false)}>Cancel</Button>
        <Button variant="danger" onclick={remove}>Delete user</Button>
    {/snippet}
</Modal>
<TempPasswordModal bind:open={tempOpen} username={tempUsername} password={tempValue}
    ondone={() => { tempValue = ''; const next = afterTemp; afterTemp = () => {}; next(); }} />
