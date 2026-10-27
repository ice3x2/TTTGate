<script lang="ts">
    import {onMount} from 'svelte';
    import CertificationCtrl from '../controller/CertificationCtrl';
    import InvalidSession from '../controller/InvalidSession';
    import type {Options} from '../controller/Options';
    import ServerOptionCtrl from '../controller/ServerOptionCtrl';
    import type {CertInfo, Group, UserView} from '../controller/Types';
    import UsersCtrl from '../controller/UsersCtrl';
    import {me} from '../me';
    import {navigate} from '../router';
    import {useSession} from '../shell/session';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Checkbox from '../ui/Checkbox.svelte';
    import GroupsCtrl from '../controller/GroupsCtrl';
    import Field from '../ui/Field.svelte';
    import Loading from '../ui/Loading.svelte';
    import Modal from '../ui/Modal.svelte';
    import NumberInput from '../ui/NumberInput.svelte';
    import Switch from '../ui/Switch.svelte';
    import {defaultRateLimit} from '../util/rateLimit';
    import Select from '../ui/Select.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {toast} from '../ui/toast';
    import BodyReplaceAppender from './parts/BodyReplaceAppender.svelte';
    import HeaderAppender from './parts/HeaderAppender.svelte';
    import InputCertFile from './parts/InputCertFile.svelte';
    import {PROTOCOLS, tunnelErrorMessage, tunnelPolicy} from './parts/tunnelPolicy';

    // 옛 layout/TunnelOptionSetLayout.svelte 21행의 정의 그대로다.
    type TunnelingOptionEx = Options & {updatable?: boolean, isSync?: boolean, certInfo?: CertInfo, certificateRevision?: number,
        originalCertificateRevision?: number, originalForwardPort?: number, allowedClientNamesQuery?: string, activeTimeout?: number};

    let {param}: {param: string} = $props();

    const ENABLED = [{value: 'true', label: 'Enabled'}, {value: 'false', label: 'Disabled'}];

    let option = $state<TunnelingOptionEx | undefined>();
    let snapshotRevision = 0;

    // U3-06: 일반 유저는 그룹 속성 안에서만 입력한다. 서버가 최종 판정하므로 여기서는 표시·기본값·요청 모양만 맞춘다.
    const policy = $derived($me ? tunnelPolicy($me) : undefined);
    const restricted = $derived(policy?.restricted === true);
    const isNew = $derived(param === 'new');
    const readOnly = $derived(!isNew && option?.editable === false);
    const portError = $derived(restricted && option && typeof option.forwardPort === 'number' && !policy!.isPortAllowed(option.forwardPort)
        ? 'Port is outside the allowed ranges.' : undefined);
    const protocolOptions = $derived(policy && option ? policy.protocolOptions(option.protocol ?? 'tcp') : PROTOCOLS);

    // 슈퍼유저의 소유자 변경. 저장 버튼과 별개로 즉시 반영한다.
    // 서버는 일반 유저의 빈 allowedClientIds 를 거부한다. 요청 전에 이유를 그 자리에 보인다.
    let trustedError = $state('');
    let owners = $state<Array<{value: string; label: string}>>([]);
    let ownerId = $state('');
    let ownerOpen = $state(false);
    const ownerLabel = $derived(owners.find((entry) => entry.value === ownerId)?.label ?? ownerId);
    let loading = $state(false);
    let confirmOpen = $state(false);

    let alertOpen = $state(false);
    let alertMessage = $state('');
    let alertButton = $state('OK');
    let alertClose = $state<() => void>(() => {});

    const session = useSession();

    const alert = (message: string, button: string, onClose: () => void) => {
        alertMessage = message;
        alertButton = button;
        alertClose = onClose;
        alertOpen = true;
    };

    const sessionOut = () => alert('Session is expired. Please login again.', 'OK', () => session.invalidate());

    const connectionFail = () => alert('Unable to connect to the server.', 'Retry', () => load());

    // 옛 _addEmptyOption(200~228행)이 넣던 값 그대로다.
    const emptyOption = (): TunnelingOptionEx => ({
        forwardPort: Math.floor(Math.random() * 65534 + 10),
        tls: false,
        protocol: 'tcp',
        httpOption: {
            rewriteHostInTextBody: true,
            replaceAccessControlAllowOrigin: false,
            customRequestHeaders: [],
            customResponseHeaders: [],
            bodyRewriteRules: []
        },
        destinationAddress: '127.0.0.1',
        destinationPort: 8080,
        isSync: false,
        inactiveOnStartup: false,
        bufferLimitOnClient: 10,
        bufferLimitOnServer: 10,
        allowedClientNamesQuery: '',
        rateLimit: defaultRateLimit('tcp')
    });

    // 옛 _validServerBuffer(86행) 그대로다.
    const validServerBuffer = (value: unknown): boolean =>
        typeof value === 'number' && Number.isFinite(value) && value >= 1 && Number.isFinite(value * 1024 * 1024);

    // 옛 _normalizePortNumber(65~73행)와 _normalizeMemBufferSize(75~83행)를 입력 시점으로 옮긴 것이다.
    const clampPort = (value: number | null): number | null => {
        if(value === null) return value;
        if(value < 0) return 0;
        if(value > 65535) return 65535;
        return value;
    };

    const clampClientBuffer = (value: number | null): number | null => {
        if(value === null) return value;
        if(value < -1) return -1;
        if(value > 1048576) return 1048576;
        return value;
    };

    // U5-06: 레이트 리밋 입력은 초·분 단위로 보이고 저장할 때 밀리초로 바꾼다. 범위 밖이면 저장을 막는다.
    const RATE_RANGES = {window: [1, 3600], max: [1, 100000], ban: [1, 1440]} as const;
    const inRange = (value: number | null, [low, high]: readonly [number, number]): boolean =>
        typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;
    let rateWindow = $state<number | null>(60);
    let rateMax = $state<number | null>(30);
    let rateBan = $state<number | null>(10);
    // 사용자가 고친 칸만 검사하고 다시 쓴다. 서버 값이 초·분으로 나누어떨어지지 않아도(API 로 넣은 1.5초 등)
    // 손대지 않은 칸은 그대로 보내므로, 다른 필드 저장이 막히거나 값이 반올림되지 않는다.
    let rateTouched = $state({window: false, max: false, ban: false});
    const rateValid = $derived((!rateTouched.window || inRange(rateWindow, RATE_RANGES.window))
        && (!rateTouched.max || inRange(rateMax, RATE_RANGES.max)) && (!rateTouched.ban || inRange(rateBan, RATE_RANGES.ban)));
    const syncRateInputs = () => {
        const limit = option?.rateLimit;
        if(!limit) return;
        rateWindow = limit.windowMs / 1000;
        rateMax = limit.maxConnections;
        rateBan = limit.banMs / 60000;
        rateTouched = {window: false, max: false, ban: false};
    };
    const onRateInput = (field: 'window' | 'max' | 'ban') => {
        if(!option?.rateLimit) return;
        option.rateLimit.customized = true;
        rateTouched[field] = true;
        if(field === 'window' && inRange(rateWindow, RATE_RANGES.window)) option.rateLimit.windowMs = rateWindow! * 1000;
        if(field === 'max' && inRange(rateMax, RATE_RANGES.max)) option.rateLimit.maxConnections = rateMax!;
        if(field === 'ban' && inRange(rateBan, RATE_RANGES.ban)) option.rateLimit.banMs = rateBan! * 60000;
    };

    const updatable = $derived(option ? ServerOptionCtrl.checkValidTunnelingOption(option) && validServerBuffer(option.bufferLimitOnServer) && rateValid : false);

    // 옛 _loadCertInfo(134~156행) 그대로다. 옛 코드는 포트로 행을 찾아 없으면 그대로 돌아갔다.
    const loadCertInfo = async (port: number) => {
        // 일반 유저는 /api/externalCert 권한이 없다(403). 인증서는 서버가 만든다.
        if(restricted) return;
        try {
            if(!option || option.forwardPort !== port) return;
            const snapshot = await CertificationCtrl.instance.loadExternalServerCert(port);
            if(!option) return;
            option.certInfo = snapshot.value;
            option.certificateRevision = snapshot.revision;
            if(option.originalCertificateRevision === undefined && option.originalForwardPort === port) {
                option.originalCertificateRevision = snapshot.revision;
            }
        } catch(e) {
            console.error(e);
            if(e instanceof InvalidSession) {
                sessionOut();
                return;
            }
            connectionFail();
        }
    };

    // 옛 _loadTunnelingOption(96~124행)에서 이 화면이 다루는 한 행의 보강만 남긴 것이다.
    const load = async () => {
        try {
            loading = true;
            const snapshot = await ServerOptionCtrl.instance.getTunnelingOption();
            snapshotRevision = snapshot.revision;
            if(param === 'new') {
                const fresh = emptyOption();
                if(policy?.restricted) {
                    policy.normalizeHttpOption(fresh);
                    // 난수 포트를 그대로 두면 Field 가 힌트 대신 오류를 그려 허용 범위 안내가 보이지 않는다.
                    fresh.forwardPort = policy.initialPort() as number;
                    // 서버는 일반 유저의 빈 allowedClientIds 를 거부한다(빈 목록은 모든 클라이언트 허용과 같다).
                    // 그룹이 허용한 신뢰 클라이언트를 모두 고른 상태로 시작한다.
                    fresh.allowedClientIds = [...policy.trustedClients];
                }
                option = fresh;
                syncRateInputs();
                loading = false;
                return;
            }
            const found = snapshot.value.find((row) => row.forwardPort === Number(param)) as TunnelingOptionEx | undefined;
            if(!found) {
                loading = false;
                navigate('#/tunnels');
                return;
            }
            found.isSync = true;
            found.originalForwardPort = found.forwardPort;
            found.allowedClientNamesQuery = found.allowedClientNames?.join('; ');
            if(!found.allowedClientNamesQuery) found.allowedClientNamesQuery = '';
            else found.allowedClientNamesQuery += ';';
            if(!found.httpOption) found.httpOption = emptyOption().httpOption;
            // 서버가 늘 채워 주지만, 없으면 프로토콜 기본값으로 시작한다.
            if(!found.rateLimit) found.rateLimit = defaultRateLimit(found.protocol);
            option = found;
            loadedOutsideIds = (found.allowedClientIds ?? []).filter((id) => !(policy?.trustedClients ?? []).includes(id));
            syncRateInputs();
            ownerId = found.owner?.id ?? '';
            if(!restricted) await loadOwners();
            await loadCertInfo(found.forwardPort);
            loading = false;
        } catch(e) {
            console.error(e);
            loading = false;
            if(e instanceof InvalidSession) {
                sessionOut();
                return;
            }
            connectionFail();
        }
    };

    // 슈퍼유저 편집 화면의 "Owner" 선택지. username 오름차순 뒤에 system:migrated 를 둔다.
    const loadOwners = async () => {
        const result = await UsersCtrl.instance.list();
        if(!result.success) {
            toast.push({tone: 'alarm', message: result.message});
            return;
        }
        ownerUsers = result.users;
        owners = [...result.users].sort((a, b) => a.username.localeCompare(b.username))
            .map((user) => ({value: user.id, label: '@' + user.username}))
            .concat([{value: 'system:migrated', label: 'system:migrated'}]);
    };

    const reassign = async () => {
        ownerOpen = false;
        if(!option) return;
        try {
            loading = true;
            const result = await ServerOptionCtrl.instance.reassignOwner(option.forwardPort, ownerId, snapshotRevision);
            loading = false;
            if(!result.success) {
                toast.push({tone: 'alarm', message: result.message});
                return;
            }
            snapshotRevision = result.revisionState.currentRevision;
            option.owner = result.owner;
            option.ownerId = result.owner.id;
            ownerId = result.owner.id;
            toast.push({tone: 'pulse', message: 'Owner changed.'});
        } catch(e) {
            console.error(e);
            loading = false;
            if(e instanceof InvalidSession) {
                sessionOut();
                return;
            }
            connectionFail();
        }
    };

    // 슈퍼유저의 신뢰 클라이언트 id 선택지. 서버는 allowedClientIds 가 있으면 이름 목록을 보지 않으므로 화면에도 보인다.
    // 등록에서 지워졌지만 터널에 남아 있는 id 도 보여야 해제할 수 있다.
    let allTrustedClients = $state<Array<{clientId: string; displayName?: string}>>([]);
    const superuserClientIds = $derived([...new Set([...allTrustedClients.map((c) => c.clientId), ...(option?.allowedClientIds ?? [])])]);
    const setSuperuserClientId = (clientId: string, on: boolean) => {
        if(!option) return;
        const current = option.allowedClientIds ?? [];
        option.allowedClientIds = superuserClientIds.filter((id) => id === clientId ? on : current.includes(id));
    };
    // 소유자 그룹이 허용하지 않은 id. 넣으면 소유자는 그 id 를 지우기 전까지 자기 터널을 저장하지 못한다.
    // 슈퍼유저 소유자는 그룹 제한을 받지 않는다.
    let ownerUsers = $state<UserView[]>([]);
    let groups = $state<Group[]>([]);
    let groupsUnavailable = $state(false);
    const ownerAllowedClientIds = $derived.by(() => {
        const owner = ownerUsers.find((user) => user.id === option?.owner?.id);
        if(!owner || owner.role === 'superuser') return undefined;
        return groups.find((group) => group.id === owner.groupId)?.attributes.allowed_trusted_clients;
    });
    const notAllowedForOwner = $derived(ownerAllowedClientIds === undefined ? []
        : (option?.allowedClientIds ?? []).filter((id) => !ownerAllowedClientIds.includes(id)));

    // 일반 유저의 신뢰 클라이언트 선택. 체크된 것이 allowedClientIds 다.
    // 슈퍼유저가 넣은 그룹 밖 id 도 보여야 해제할 수 있다. 해제해도 이 화면에서는 목록에 남겨 다시 고를 수 있다.
    let loadedOutsideIds = $state<string[]>([]);
    const outsideGroupClientIds = $derived((option?.allowedClientIds ?? []).filter((id) => !(policy?.trustedClients ?? []).includes(id)));
    const restrictedClientIds = $derived([...(policy?.trustedClients ?? []), ...loadedOutsideIds]);
    const trusted = (clientId: string): boolean => option?.allowedClientIds?.includes(clientId) === true;
    const setTrusted = (clientId: string, on: boolean) => {
        if(!option || !policy) return;
        const current = option.allowedClientIds ?? [];
        option.allowedClientIds = restrictedClientIds.filter((id) => id === clientId ? on : current.includes(id));
    };

    // 옛 _onChangeSecureTunneling(344~351행) 그대로다.
    const onChangeSecureTunneling = async (forwardPort: number) => {
        if(!option) return;
        await loadCertInfo(forwardPort);
    };

    // 옛 _onChangeProtocol(233~242행) 그대로다.
    const onChangeProtocol = () => {
        if(!option) return;
        if(option.protocol == 'https') {
            const old = option.tls;
            option.tls = true;
            if(!old) onChangeSecureTunneling(option.forwardPort);
        } else {
            option.tls = false;
        }
        // D9: 사용자가 직접 고치지 않은 레이트 리밋만 새 프로토콜의 기본값으로 바꾼다. 켜짐 여부는 그대로 둔다.
        // 이전 버전에서 넘어와 꺼져 있던 터널이 프로토콜만 바꿔도 몰래 켜지면 안 된다.
        if(option.rateLimit && !option.rateLimit.customized) {
            option.rateLimit = {...defaultRateLimit(option.protocol), enabled: option.rateLimit.enabled};
            syncRateInputs();
        }
    };

    // 옛 _onClickApply(279~313행)와 같다. 성공 뒤 목록과 상태를 다시 읽던 부분만 토스트와 목록 이동으로 바뀌었다.
    const apply = async () => {
        if(!option) return;
        trustedError = '';
        // 그룹 밖 id 가 남아 있으면 서버가 422 trusted_client_not_allowed 로 거부한다. 요청 전에 이유를 보인다.
        if(restricted && outsideGroupClientIds.length > 0) {
            trustedError = 'Remove the client IDs your group does not allow.';
            return;
        }
        // 고를 대상이 있을 때만 막는다. 그룹이 허용한 클라이언트가 없으면 서버가 순서대로 판정한다(포트 검사가 먼저다).
        if(restricted && policy!.trustedClients.length > 0 && (option.allowedClientIds ?? []).length === 0) {
            trustedError = 'Select at least one trusted client.';
            return;
        }
        loading = true;
        if(restricted) {
            // 일반 유저는 allowedClientNames 를 보내지 않는다(서버가 422 legacy_client_names_not_allowed 로 거부한다).
            policy!.normalizeHttpOption(option);
            delete option.allowedClientNames;
            option.allowedClientIds = option.allowedClientIds ?? [];
        } else {
            option.allowedClientNames = option.allowedClientNamesQuery!.split(';').map((name) => name.trim()).filter((name) => name !== '');
        }
        const payload = $state.snapshot(option) as TunnelingOptionEx;
        try {
            const result = await ServerOptionCtrl.instance.updateTunnelingOption(payload, snapshotRevision, restricted
                ? {previousForwardPort: payload.originalForwardPort}
                : {
                    certInfo: payload.tls ? payload.certInfo : undefined,
                    expectedCertificateRevision: payload.originalForwardPort !== undefined && payload.originalForwardPort !== payload.forwardPort
                        ? payload.originalCertificateRevision : payload.certificateRevision,
                    previousForwardPort: payload.originalForwardPort,
                });
            loading = false;
            if(result.success) {
                toast.push({tone: 'pulse', message: 'Success to apply tunneling option'});
                navigate('#/tunnels');
            } else {
                // 접두어는 유지한다(configuration-editor 테스트가 /Fail/ 로 기다린다).
                toast.push({tone: 'alarm', message: 'Fail to apply tunneling option: ' + tunnelErrorMessage(result.code, result.message)});
            }
        } catch(e) {
            console.error(e);
            loading = false;
            if(e instanceof InvalidSession) {
                sessionOut();
                return;
            }
            connectionFail();
        }
    };

    // 옛 _onClickRemove(245~277행)와 같다. 삭제 버튼은 저장된 터널에만 있으므로 미동기 분기를 두지 않았다.
    const remove = async () => {
        if(!option) return;
        loading = true;
        const payload = $state.snapshot(option) as TunnelingOptionEx;
        try {
            const result = await ServerOptionCtrl.instance.removeTunnelingOption(payload, snapshotRevision);
            loading = false;
            if(result.success) {
                toast.push({tone: 'pulse', message: 'Tunneling option has been removed. The external server has been shut down.'});
                navigate('#/tunnels');
            } else {
                toast.push({tone: 'alarm', message: 'Fail: ' + result.message});
            }
        } catch(e) {
            console.error(e);
            loading = false;
            if(e instanceof InvalidSession) {
                sessionOut();
                return;
            }
            connectionFail();
        }
    };

    onMount(() => {
        load();
        // 일반 유저는 이 API 를 쓸 수 없다(403·access_denied 감사가 남지 않게 부르지 않는다).
        if(policy && !policy.restricted) {
            void GroupsCtrl.instance.trustedClients().then((result) => { if(result.success) allTrustedClients = result.trustedClients; })
                .catch(() => { /* 선택지가 없어도 이름 목록은 쓸 수 있다 */ });
            // 소유자 그룹의 허용 목록을 비교하려고 읽는다. 실패하면 경고만 보이지 않는다.
            void GroupsCtrl.instance.list().then((result) => {
                if(result.success) groups = result.groups; else groupsUnavailable = true;
            }).catch(() => { groupsUnavailable = true; });
        }
    });
</script>

{#if option}
{#if readOnly}
    <p id="tunnel-readonly-note">This tunnel is shared with you as read only.</p>
{/if}
<form class="tunnel-edit" onsubmit={(e) => e.preventDefault()}>
<!-- 읽기 전용이면 fieldset 이 안의 입력(부품·appender 포함)을 모두 비활성화한다. -->
<fieldset disabled={readOnly} style="border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: var(--s-4);">
    {#if !isNew && !restricted}
        <Card>
            <div class="form-stack">
                <Field label="Owner" for="tunnel-owner">
                    <div style="display: flex; gap: var(--s-2); align-items: center;">
                        <Select id="tunnel-owner" options={owners} bind:value={ownerId} />
                        <Button disabled={ownerId === (option.owner?.id ?? '')} onclick={() => (ownerOpen = true)}>Change owner</Button>
                    </div>
                </Field>
            </div>
        </Card>
    {/if}
    <Card>
        <div class="form-stack">
            <Field label="External server port" for="input-external-port" hint={restricted ? policy!.portHint() : undefined} error={portError}>
                <NumberInput id="input-external-port" min={1} max={65535} bind:value={option.forwardPort}
                    oninput={(v) => (option!.forwardPort = clampPort(v) as number)} />
            </Field>
            <Checkbox id="input-tls" label="Secure tunneling Server/Client" bind:checked={option.tls}
                disabled={option.protocol !== 'tcp'} onchange={() => onChangeSecureTunneling(option!.forwardPort)} />
            {#if option.tls === true}
                {#if restricted}
                    <p id="tunnel-cert-note">A generated certificate will be used.</p>
                {:else}
                    <div id="tunnel-cert">
                        <InputCertFile certInfo={option.certInfo} hideMessage={true} onupdate={(value) => (option!.certInfo = value)} />
                    </div>
                {/if}
                <Field label="Destination certificate" for="input-allow-self-signed"
                    hint="The client accepts any certificate from the destination server, including self-signed ones. Use it only on a trusted network.">
                    <!-- 옛 설정에는 이 값이 없어 undefined 다. 기본값이 있는 bind 는 undefined 를 받지 못하므로 함수 바인딩을 쓴다. -->
                    <Checkbox id="input-allow-self-signed" label="Skip certificate verification (allow self-signed)"
                        bind:checked={() => option!.allowSelfSignedDestinationCert === true, (on) => (option!.allowSelfSignedDestinationCert = on)} />
                </Field>
            {/if}
            <Field label="Destination host" for="input-destination-host">
                <TextInput id="input-destination-host" bind:value={option.destinationAddress} />
            </Field>
            <Field label="Destination port" for="input-destination-port">
                <NumberInput id="input-destination-port" min={1} max={65535} bind:value={option.destinationPort}
                    oninput={(v) => (option!.destinationPort = clampPort(v) as number)} />
            </Field>
            {#if restricted}
                <Field label="Trusted clients" error={trustedError || undefined}>
                    <div style="display: flex; flex-wrap: wrap; gap: var(--s-4);">
                        {#each restrictedClientIds as clientId (clientId)}
                            <Checkbox id={`tunnel-trusted-${clientId}`}
                                label={loadedOutsideIds.includes(clientId) ? `${clientId} (not allowed for your group)` : clientId}
                                bind:checked={() => trusted(clientId), (on) => setTrusted(clientId, on)} />
                        {:else}
                            <p>No trusted clients are allowed for your group.</p>
                        {/each}
                    </div>
                </Field>
                {#if outsideGroupClientIds.length > 0}
                    <p id="tunnel-trusted-not-allowed" role="note" style="margin: 0; color: var(--alarm);">Your group does not allow {outsideGroupClientIds.join(', ')}. Clear it before you save.</p>
                {/if}
            {:else}
                <Field label="Trusted client IDs">
                    <div style="display: flex; flex-wrap: wrap; gap: var(--s-4);">
                        {#each superuserClientIds as clientId (clientId)}
                            <Checkbox id={`tunnel-client-id-${clientId}`} label={allTrustedClients.find((c) => c.clientId === clientId)?.displayName ?? clientId}
                                bind:checked={() => option!.allowedClientIds?.includes(clientId) === true, (on) => setSuperuserClientId(clientId, on)} />
                        {:else}
                            <p>No trusted clients are registered.</p>
                        {/each}
                    </div>
                </Field>
                <Field label="Allowed client names (Separate names with semicolon(;))" for="input-allow-client-names">
                    <TextInput id="input-allow-client-names" bind:value={option.allowedClientNamesQuery} />
                </Field>
                {#if groupsUnavailable && (option.allowedClientIds ?? []).length > 0}
                    <p id="tunnel-client-ids-owner-unknown" role="note" style="margin: 0; color: var(--ink-2);">Could not read the owner's group, so these IDs are not checked against it.</p>
                {/if}
                {#if notAllowedForOwner.length > 0}
                    <p id="tunnel-client-ids-not-allowed" role="alert" style="margin: 0; color: var(--alarm);">The owner's group does not allow {notAllowedForOwner.join(', ')}. The owner cannot save this tunnel until it is removed.</p>
                {/if}
                {#if (option.allowedClientIds ?? []).length > 0}
                    <p id="tunnel-client-ids-priority" role="note" style="margin: 0; color: var(--ink-2);">Trusted client IDs are set, so the client names above are ignored.</p>
                {/if}
            {/if}
            <Field label="Keep-Alive timeout (ms)" for="input-active-timeout">
                <!-- 새 터널에는 keepAlive 가 없다. 그대로 bind 하면 fallback 이 있는 prop 에 undefined 가 들어가 Svelte 가 거부하므로,
                     읽기는 null 로 바꾸고 쓰기는 빈 값을 다시 undefined 로 되돌려 옛 저장 본문과 같은 모양을 지킨다. -->
                <NumberInput id="input-active-timeout"
                    bind:value={() => option!.keepAlive ?? null, (value) => (option!.keepAlive = value ?? undefined)} />
            </Field>
        </div>
    </Card>
    <Card label="Buffer limit per session (MiB)">
        <div class="two-col">
            <Field label="Server" for="input-buffer-limit-server"
                error={validServerBuffer(option.bufferLimitOnServer) ? undefined : 'Server buffer must be a finite number of at least 1 MiB.'}>
                <NumberInput id="input-buffer-limit-server" min={1} step="any"
                    invalid={!validServerBuffer(option.bufferLimitOnServer)} bind:value={option.bufferLimitOnServer} />
            </Field>
            <Field label="Client" for="input-buffer-limit-client">
                <NumberInput id="input-buffer-limit-client" bind:value={option.bufferLimitOnClient}
                    oninput={(v) => (option!.bufferLimitOnClient = clampClientBuffer(v) as number)} />
            </Field>
        </div>
        <ul class="notes">
            <li>Server buffer: finite values of at least 1 MiB; fractions are allowed.</li>
            <li>Client buffer: nonpositive values retain the existing unlimited setting.</li>
            <li>Positive limits spill excess buffered data to the file cache.</li>
        </ul>
    </Card>
    <Card>
        <div class="form-stack">
            <Field label="Protocol" for="select-protocol">
                <Select id="select-protocol" options={protocolOptions} bind:value={option.protocol} onchange={onChangeProtocol} />
            </Field>
            {#if option.rateLimit}
                <Card label="Rate limit">
                    <div class="form-stack">
                        <!-- 스위치도 사용자가 고친 값이다(D9). 끈 뒤 프로토콜을 바꿔도 기본값으로 되돌리지 않는다. -->
                        <Switch ariaLabel="Rate limit enabled" disabled={readOnly} bind:on={option.rateLimit.enabled}
                            onchange={() => { if(option?.rateLimit) option.rateLimit.customized = true; }} />
                        <Field label="Window (seconds)" for="input-rate-window" error={!rateTouched.window || inRange(rateWindow, RATE_RANGES.window) ? undefined : '1..3600'}>
                            <NumberInput id="input-rate-window" min={1} max={3600} invalid={rateTouched.window && !inRange(rateWindow, RATE_RANGES.window)}
                                bind:value={rateWindow} oninput={() => onRateInput('window')} />
                        </Field>
                        <Field label="Max connections per IP" for="input-rate-max" error={!rateTouched.max || inRange(rateMax, RATE_RANGES.max) ? undefined : '1..100000'}>
                            <NumberInput id="input-rate-max" min={1} max={100000} invalid={rateTouched.max && !inRange(rateMax, RATE_RANGES.max)}
                                bind:value={rateMax} oninput={() => onRateInput('max')} />
                        </Field>
                        <Field label="Ban duration (minutes)" for="input-rate-ban" error={!rateTouched.ban || inRange(rateBan, RATE_RANGES.ban) ? undefined : '1..1440'}>
                            <NumberInput id="input-rate-ban" min={1} max={1440} invalid={rateTouched.ban && !inRange(rateBan, RATE_RANGES.ban)}
                                bind:value={rateBan} oninput={() => onRateInput('ban')} />
                        </Field>
                        <p class="notes" style="margin: 0; padding: 0; list-style: none;">Blocks an IP that opens more than N connections within the window. Browsers open several connections per page; keep HTTP limits higher.</p>
                    </div>
                </Card>
            {/if}
            {#if (option.protocol === 'http' || option.protocol === 'https') && (policy?.showHttpOptions ?? true)}
                <h2 class="section-title">HTTP options</h2>
                {#if policy?.rewrite.host ?? true}
                    <Field label="Replace host (address) in text body" for="select-change-host-in-body">
                        <Select id="select-change-host-in-body" options={ENABLED}
                            value={String(option.httpOption.rewriteHostInTextBody ?? true)}
                            onchange={(v) => (option!.httpOption.rewriteHostInTextBody = v === 'true')} />
                    </Field>
                {/if}
                {#if policy?.rewrite.cors ?? true}
                    <Field label="Replace Access-Control-Allow-Origin header" for="select-change-acao">
                        <Select id="select-change-acao" options={ENABLED}
                            value={String(option.httpOption.replaceAccessControlAllowOrigin ?? false)}
                            onchange={(v) => (option!.httpOption.replaceAccessControlAllowOrigin = v === 'true')} />
                    </Field>
                {/if}
                {#if policy?.rewrite.header ?? true}
                    <div id="http-request-headers">
                        <Field label="Inject request header">
                            <HeaderAppender bind:options={option.httpOption.customRequestHeaders} />
                        </Field>
                    </div>
                    <div id="http-response-headers">
                        <Field label="Inject response header">
                            <HeaderAppender bind:options={option.httpOption.customResponseHeaders} />
                        </Field>
                    </div>
                {/if}
                {#if policy?.rewrite.body ?? true}
                    <div id="http-body-rewrite">
                        <Field label="Replace text in body">
                            <BodyReplaceAppender bind:options={option.httpOption.bodyRewriteRules} />
                        </Field>
                    </div>
                {/if}
            {/if}
            <Checkbox id="input-inactive-on-startup" label="Inactive on startup" bind:checked={option.inactiveOnStartup} />
        </div>
    </Card>
</fieldset>
</form>
{#if !readOnly}
<div class="edit-bar">
    <Button variant="primary" disabled={!updatable} onclick={apply}>{option.isSync ? 'Apply and Restart' : 'Start'}</Button>
    {#if option.isSync}
        <Button variant="danger" onclick={() => (confirmOpen = true)}>Stop and Remove</Button>
    {/if}
</div>
{/if}
<Modal bind:open={ownerOpen} title="Change owner">
    Move tunnel {option.forwardPort} to {ownerLabel}?
    {#snippet footer()}
        <Button onclick={() => (ownerOpen = false)}>Cancel</Button>
        <Button variant="primary" onclick={() => { void reassign(); }}>Move</Button>
    {/snippet}
</Modal>
<Modal bind:open={confirmOpen} title="Remove tunnel">
    Remove tunnel {option.forwardPort}? The external server will be stopped.
    {#snippet footer()}
        <Button onclick={() => (confirmOpen = false)}>Cancel</Button>
        <Button variant="danger" onclick={() => { confirmOpen = false; remove(); }}>Remove</Button>
    {/snippet}
</Modal>
{/if}
{#if loading}<Loading overlay />{/if}
<Modal bind:open={alertOpen} title="Tunnel">
    {alertMessage}
    {#snippet footer()}
        <Button variant="primary" onclick={() => { alertOpen = false; alertClose(); }}>{alertButton}</Button>
    {/snippet}
</Modal>

<style>
    .tunnel-edit { display: flex; flex-direction: column; gap: var(--s-4); }
    .form-stack { display: flex; flex-direction: column; gap: var(--s-4); }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3); }
    .notes { margin: var(--s-3) 0 0; padding-left: var(--s-4); font-size: var(--fs-xs); color: var(--ink-2); }
    .section-title { font-family: var(--ff-display); font-size: var(--fs-lg); margin: var(--s-2) 0 0; }
    .edit-bar {
        position: sticky;
        bottom: 0;
        z-index: 40;
        display: flex;
        gap: var(--s-3);
        justify-content: flex-end;
        padding: var(--s-3) 0;
        margin-top: var(--s-4);
        background: var(--bg-1);
        border-top: 1px solid var(--line-0);
    }
</style>
