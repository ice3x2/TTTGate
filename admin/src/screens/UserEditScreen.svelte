<script lang="ts">
    import {onMount} from 'svelte';
    import InvalidSession from '../controller/InvalidSession';
    import GroupsCtrl from '../controller/GroupsCtrl';
    import SessionsCtrl from '../controller/SessionsCtrl';
    import UsersCtrl from '../controller/UsersCtrl';
    import type {Role, UserStatus, UserView} from '../controller/Types';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Checkbox from '../ui/Checkbox.svelte';
    import Chip from '../ui/Chip.svelte';
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
    import {errorMessageOf} from '../i18n/serverError';
    import {t, plural} from '../i18n';

    // U3-03: #/users/new 와 #/users/<id>. 역할이 superuser 면 서버가 그룹을 정하므로 groupId 를 보내지 않는다.
    let {param}: {param: string} = $props();

    const session = useSession();
    const isNew = $derived(param === 'new');

    const ROLES = [{value: 'superuser', label: t('user.roleSuperuser')}, {value: 'regular', label: t('user.roleRegular')}];
    const STATUSES = [{value: 'active', label: t('user.statusActive')}, {value: 'disabled', label: t('user.statusDisabled')}];
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
    // 이슈 346: 비밀번호 초기화 때 2단계 수단(TOTP·패스키)도 지울지. 확인 창을 열 때마다 켬으로 되돌린다.
    let resetSecondFactors = $state(true);
    let tempSecondFactorsReset = $state(false);

    // U4-09: 수정 화면의 Two-factor 행. 초기화하면 서버가 그 사용자의 세션을 모두 끊는다.
    let resetMfaOpen = $state(false);
    const resetMfa = () => {
        resetMfaOpen = false;
        void run(async () => {
            if(!loaded) return;
            const id = loaded.id;
            const result = await UsersCtrl.instance.resetMfa(id);
            if(!result.success) {
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
                return;
            }
            // 저장하지 않은 폼 편집을 덮지 않도록 MFA 상태만 바꾼다.
            if(loaded) loaded = {...loaded, mfaEnabled: result.user.mfaEnabled === true};
            toast.push({tone: 'pulse', message: t('user.mfaResetDone')});
            await loadSessionCount(id);
        });
    };

    // 이슈 336: 수정 화면의 Passkeys 행. 모두 지우면 서버가 그 사용자의 세션을 모두 끊는다.
    const passkeyCount = $derived(loaded?.passkeyCount ?? 0);
    const hasSecondFactor = $derived(loaded?.mfaEnabled === true || passkeyCount > 0);
    const resetsSecondFactors = $derived(hasSecondFactor && resetSecondFactors);
    let resetPasskeysOpen = $state(false);
    const resetPasskeys = () => {
        resetPasskeysOpen = false;
        void run(async () => {
            if(!loaded) return;
            const id = loaded.id;
            const result = await UsersCtrl.instance.resetPasskeys(id);
            if(!result.success) {
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
                return;
            }
            // 저장하지 않은 폼 편집을 덮지 않도록 패스키 수만 바꾼다.
            if(loaded) loaded = {...loaded, passkeyCount: result.user.passkeyCount ?? 0};
            toast.push({tone: 'pulse', message: t('user.passkeysRemoved')});
            await loadSessionCount(id);
        });
    };

    // U4-06: 수정 화면의 Sessions 행. 전체 세션 목록을 이 사용자 id 로 센다.
    let sessionCount = $state(0);
    let endSessionsOpen = $state(false);

    const loadSessionCount = async (id: string): Promise<void> => {
        const result = await SessionsCtrl.instance.list();
        if(result.success) sessionCount = result.sessions.filter((entry) => entry.userId === id).length;
    };

    const endSessions = () => {
        endSessionsOpen = false;
        void run(async () => {
            if(!loaded) return;
            const id = loaded.id;
            const result = await SessionsCtrl.instance.killAllForUser(id);
            if(!result.success) {
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
                return;
            }
            if(result.self) {
                session.invalidate();
                return;
            }
            toast.push({tone: 'pulse', message: t('sessions.endedCount', {count: result.removed})});
            await loadSessionCount(id);
        });
    };

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
            else toast.push({tone: 'alarm', message: t('common.unableToConnect')});
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

    const validate = (): {username?: string; tempPassword?: string} => {
        if(!isNew) return {};
        if(!USERNAME_PATTERN.test(username)) return {username: t('user.usernameInvalid')};
        if(!tempAuto && tempPassword.length < 8) return {tempPassword: t('password.tooShort')};
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
            formError = errorMessageOf(result);
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
            formError = errorMessageOf(result);
            return;
        }
        toast.push({tone: 'pulse', message: t('user.saved')});
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
            const cleared = resetsSecondFactors;
            const result = await UsersCtrl.instance.resetPassword(id, {resetSecondFactors: cleared});
            if(!result.success) {
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
                return;
            }
            tempSecondFactorsReset = cleared;
            // 초기화는 그 사용자의 세션을 모두 끝낸다. 세션 수도 다시 읽는다.
            showTemp(loaded.username, result.temporaryPassword, () => {
                tempSecondFactorsReset = false;
                void run(async () => { await reload(id); await loadSessionCount(id); });
            });
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
                toast.push({tone: 'pulse', message: t('user.deleted')});
                navigate('#/users');
            } else {
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
            }
        });
    };

    onMount(() => {
        void run(async () => {
            const listed = await GroupsCtrl.instance.list();
            if(listed.success) {
                groups = listed.groups.filter((group) => group.id !== 'system:superuser').map((group) => ({value: group.id, label: group.name}));
            } else {
                toast.push({tone: 'alarm', message: errorMessageOf(listed)});
            }
            if(!isNew) {
                await reload(param);
                await loadSessionCount(param);
            }
        });
    });
</script>

<form id="user-form" onsubmit={submit} novalidate style="display: flex; flex-direction: column; gap: var(--s-4);">
    <Card>
        <div style="display: flex; flex-direction: column; gap: var(--s-4);">
            <Field label={t('user.username')} hint={t('user.usernameHint')} for="user-username" error={errors.username}>
                <TextInput id="user-username" autocomplete="off" disabled={!isNew} invalid={errors.username !== undefined} bind:value={username} />
            </Field>
            <Field label={t('user.displayName')} for="user-display-name">
                <TextInput id="user-display-name" bind:value={displayName} />
            </Field>
            <Field label={t('user.role')} for="user-role">
                <Select id="user-role" options={ROLES} bind:value={() => role, (value) => (role = value as Role)} onchange={onRole} />
            </Field>
            {#if role === 'regular'}
                <Field label={t('user.group')} for="user-group">
                    <Select id="user-group" options={groups} bind:value={groupId} />
                </Field>
            {/if}
            {#if !isNew}
                <Field label={t('user.status')} for="user-status">
                    <Select id="user-status" options={STATUSES} bind:value={() => status, (value) => (status = value as UserStatus)} />
                </Field>
            {/if}
        </div>
    </Card>
    {#if isNew}
        <Card label={t('user.tempPassword')}>
            <div style="display: flex; flex-direction: column; gap: var(--s-4);">
                <Checkbox id="user-temp-auto" label={t('user.generateAutomatically')} bind:checked={tempAuto} />
                {#if !tempAuto}
                    <Field label={t('user.tempPassword')} hint={t('password.minHint')} for="user-temp-password" error={errors.tempPassword}>
                        <TextInput id="user-temp-password" type="password" autocomplete="new-password"
                            invalid={errors.tempPassword !== undefined} bind:value={tempPassword} />
                    </Field>
                {/if}
            </div>
        </Card>
    {/if}
    {#if !isNew}
        <section id="user-mfa">
            <Card label={t('user.twoFactor')}>
                <div style="display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between;">
                    <div style="display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center;">
                        <span id="user-mfa-status" style="font-size: var(--fs-md); color: {loaded?.mfaEnabled ? 'var(--pulse)' : 'var(--ink-2)'};">{t(loaded?.mfaEnabled ? 'user.mfaEnabled' : 'user.mfaOff')}</span>
                        {#if loaded?.mfaRequired}<span id="user-mfa-required"><Chip tone="warn">{t('user.mfaRequired')}</Chip></span>{/if}
                    </div>
                    <span id="user-reset-mfa"><Button variant="danger" disabled={pending || loaded?.mfaEnabled !== true} onclick={() => (resetMfaOpen = true)}>{t('user.resetMfa')}</Button></span>
                </div>
            </Card>
        </section>
        <section id="user-passkeys">
            <Card label={t('user.passkeys')}>
                <div style="display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between;">
                    <span id="user-passkey-count">{plural('user.passkeyCount', passkeyCount)}</span>
                    <span id="user-reset-passkeys"><Button variant="danger" disabled={pending || passkeyCount === 0} onclick={() => (resetPasskeysOpen = true)}>{t('user.removePasskeys')}</Button></span>
                </div>
            </Card>
        </section>
        <section id="user-sessions">
            <Card label={t('user.sessions')}>
                <div style="display: flex; flex-wrap: wrap; gap: var(--s-3); align-items: center; justify-content: space-between;">
                    <span id="user-session-count">{t('user.activeSessions', {count: sessionCount})}</span>
                    <span id="user-end-sessions"><Button variant="danger" disabled={pending || sessionCount === 0} onclick={() => (endSessionsOpen = true)}>{t('user.endAllSessions')}</Button></span>
                </div>
            </Card>
        </section>
    {/if}
    {#if formError}
        <p id="user-form-error" role="alert">{formError}</p>
    {/if}
    <!-- 하단 고정 바. 흐름 안의 sticky 라서 폼 마지막 입력을 덮지 않는다(TunnelEditScreen 과 같은 배치). -->
    <div style="position: sticky; bottom: 0; z-index: 40; display: flex; flex-wrap: wrap; gap: var(--s-3); justify-content: flex-end;
        padding: var(--s-3) 0; margin-top: var(--s-4); background: var(--bg-1); border-top: 1px solid var(--line-0);">
        {#if isNew}
            <Button variant="primary" type="submit" disabled={pending}>{t('user.create')}</Button>
        {:else}
            <Button disabled={pending || !loaded} onclick={() => { resetSecondFactors = true; resetOpen = true; }}>{t('user.resetPassword')}</Button>
            <Button variant="danger" disabled={pending || !loaded} onclick={() => (deleteOpen = true)}>{t('common.delete')}</Button>
            <Button variant="primary" type="submit" disabled={pending || !dirty}>{t('common.save')}</Button>
        {/if}
    </div>
</form>

<Modal bind:open={resetOpen} title={t('user.resetPassword')} class="reset-password-modal">
    <div style="display: flex; flex-direction: column; gap: var(--s-3);">
        <p style="margin: 0;">{t('user.resetPasswordConfirm', {username: loaded?.username ?? ''})}</p>
        <!-- 이슈 346: 2단계 수단을 잃은 사용자를 복구할 때 함께 지운다. 지울 수단이 없으면 끈 채 막는다. -->
        <Checkbox id="user-reset-second-factors" label={t('user.alsoResetSecondFactors')} disabled={!hasSecondFactor}
            bind:checked={() => resetsSecondFactors, (on) => (resetSecondFactors = on)} />
        <p id="user-reset-second-factors-hint" style="margin: 0; color: var(--ink-2); font-size: var(--fs-sm);">{t(!hasSecondFactor
            ? 'user.resetHintNothing'
            : resetSecondFactors
                ? (loaded?.mfaRequired ? 'user.resetHintMfaRequired' : 'user.resetHintMfaOptional')
                : (loaded?.mfaRequired && loaded?.mfaEnabled !== true ? 'user.resetHintPasskeyOnly' : 'user.resetHintKeep'))}</p>
    </div>
    {#snippet footer()}
        <Button onclick={() => (resetOpen = false)}>{t('common.cancel')}</Button>
        {#if resetsSecondFactors}
            <Button variant="danger" onclick={resetPassword}>{t('user.resetAndIssue')}</Button>
        {:else}
            <Button variant="primary" onclick={resetPassword}>{t('user.issuePassword')}</Button>
        {/if}
    {/snippet}
</Modal>
<Modal bind:open={deleteOpen} title={t('user.delete')}>
    {t('user.deleteConfirm', {username: loaded?.username ?? ''})}
    {#snippet footer()}
        <Button onclick={() => (deleteOpen = false)}>{t('common.cancel')}</Button>
        <Button variant="danger" onclick={remove}>{t('user.delete')}</Button>
    {/snippet}
</Modal>
<Modal bind:open={resetMfaOpen} title={t('user.resetTwoFactor')} class="reset-mfa-modal">
    {t('user.resetMfaConfirm', {username: loaded?.username ?? ''})}
    {#snippet footer()}
        <Button onclick={() => (resetMfaOpen = false)}>{t('common.cancel')}</Button>
        <span id="confirm-reset-mfa"><Button variant="danger" onclick={resetMfa}>{t('user.reset')}</Button></span>
    {/snippet}
</Modal>
<Modal bind:open={resetPasskeysOpen} title={t('user.removePasskeys')} class="reset-passkeys-modal">
    {t('user.removePasskeysConfirm', {username: loaded?.username ?? ''})}
    {#snippet footer()}
        <Button onclick={() => (resetPasskeysOpen = false)}>{t('common.cancel')}</Button>
        <span id="confirm-reset-passkeys"><Button variant="danger" onclick={resetPasskeys}>{t('common.remove')}</Button></span>
    {/snippet}
</Modal>
<Modal bind:open={endSessionsOpen} title={t('user.endAllSessions')} class="end-all-modal">
    {t('user.endAllConfirm', {username: loaded?.username ?? ''})}
    {#snippet footer()}
        <Button onclick={() => (endSessionsOpen = false)}>{t('common.cancel')}</Button>
        <span id="confirm-end-all"><Button variant="danger" onclick={endSessions}>{t('sessions.endAll')}</Button></span>
    {/snippet}
</Modal>
<TempPasswordModal bind:open={tempOpen} username={tempUsername} password={tempValue} secondFactorsReset={tempSecondFactorsReset}
    ondone={() => { tempValue = ''; const next = afterTemp; afterTemp = () => {}; next(); }} />
