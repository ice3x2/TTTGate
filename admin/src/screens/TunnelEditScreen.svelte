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
    import TunnelStatusArea from './parts/TunnelStatusArea.svelte';
    import ShareUsersField from './parts/ShareUsersField.svelte';
    import type {SharedUser} from './parts/shareUsers';
    import {PROTOCOLS, tunnelPolicy} from './parts/tunnelPolicy';
    import PortRangeChips from './parts/PortRangeChips.svelte';
    import {RATE_RANGES, rateRangeError} from './parts/rateLimitRange';
    import {bufferIssue, defaultBuffer, groupBufferCap, type BufferIssue} from './parts/bufferPolicy';
    import {t} from '../i18n';
    import {errorMessageOf} from '../i18n/serverError';

    // 옛 layout/TunnelOptionSetLayout.svelte 21행의 정의 그대로다.
    type TunnelingOptionEx = Options & {updatable?: boolean, isSync?: boolean, certInfo?: CertInfo, certificateRevision?: number,
        originalCertificateRevision?: number, originalForwardPort?: number, allowedClientNamesQuery?: string, activeTimeout?: number};

    let {param}: {param: string} = $props();

    const ENABLED = [{value: 'true', label: t('tunnelEdit.enabled')}, {value: 'false', label: t('tunnelEdit.disabled')}];

    let option = $state<TunnelingOptionEx | undefined>();
    let usedPorts = $state<number[]>([]);
    // 이슈 366: 그룹 연결당 버퍼 최댓값과 불러온 값. 저장된 값을 그대로 두면 상한을 넘어도 경고만 한다.
    const bufferCap = $derived($me ? groupBufferCap($me) : null);
    let storedBuffers = $state<{server?: number; client?: number}>({});
    const serverBufferIssue = $derived(option ? bufferIssue('server', option.bufferLimitOnServer, storedBuffers.server, bufferCap) : undefined);
    const clientBufferIssue = $derived(option ? bufferIssue('client', option.bufferLimitOnClient, storedBuffers.client, bufferCap) : undefined);
    // 이슈 366: 저장된 값을 그대로 두는 칸에는 max 를 걸지 않는다(브라우저가 그 값을 틀렸다고 보이지 않게).
    const bufferMaxAttr = (issue: BufferIssue | undefined): number | undefined => bufferCap !== null && issue !== 'stored-over' ? bufferCap : undefined;
    // 이슈 366 FR-12: 상한을 넘은 저장값은 칸마다 이름과 값을 넣어 한 줄씩 경고한다.
    const storedOverLines = $derived(!option ? [] : [
        ...(serverBufferIssue === 'stored-over' ? [{id: 'server', text: t('tunnelEdit.bufferStoredOver',
            {field: t('tunnelEdit.server'), value: option.bufferLimitOnServer ?? 0, max: bufferCap ?? 0})}] : []),
        ...(clientBufferIssue === 'stored-over' ? [{id: 'client', text: (option.bufferLimitOnClient ?? 0) < 1
            ? t('tunnelEdit.bufferStoredUnlimited', {max: bufferCap ?? 0})
            : t('tunnelEdit.bufferStoredOver', {field: t('tunnelEdit.client'), value: option.bufferLimitOnClient ?? 0, max: bufferCap ?? 0})}] : []),
    ]);
    let snapshotRevision = 0;

    // U3-06: 일반 유저는 그룹 속성 안에서만 입력한다. 서버가 최종 판정하므로 여기서는 표시·기본값·요청 모양만 맞춘다.
    const policy = $derived($me ? tunnelPolicy($me) : undefined);
    const restricted = $derived(policy?.restricted === true);
    const isNew = $derived(param === 'new');
    const readOnly = $derived(!isNew && option?.editable === false);
    // 이슈 347: 켜고 끄기(상태 영역의 Timer)는 고치기와 따로 판정한다. 옛 서버 응답에는 toggleable 이 없다.
    const toggleable = $derived(option?.toggleable ?? !readOnly);
    // 이슈 347 FR-10: 공유 칸의 칩. 고칠 수 있는 사람에게만 서버가 sharedUsers 를 준다.
    let sharedUsers = $state<SharedUser[]>([]);
    // 사용자 검색은 슈퍼유저와 full 그룹만 쓴다. 새 터널 화면에 직접 들어온 다른 사용자에게는 칸을 보이지 않는다.
    const canShare = $derived(!readOnly && (!restricted || $me?.group.attributes.tunnel_crud === 'full'));
    const portError = $derived(restricted && option && typeof option.forwardPort === 'number' && !policy!.isPortAllowed(option.forwardPort)
        ? t('tunnelEdit.portOutside') : undefined);
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
    // 이슈 338: 화면에 보이는 이름(선택). 앞뒤 공백을 뺀 40 코드 포인트까지다. 형식의 최종 판정은 서버가 한다.
    const NAME_MAX = 40;
    let nameInput = $state('');
    let nameError = $state('');

    let alertOpen = $state(false);
    let alertMessage = $state('');
    let alertButton = $state(t('common.ok'));
    let alertClose = $state<() => void>(() => {});

    const session = useSession();

    const alert = (message: string, button: string, onClose: () => void) => {
        alertMessage = message;
        alertButton = button;
        alertClose = onClose;
        alertOpen = true;
    };

    const sessionOut = () => alert(t('common.sessionExpired'), t('common.ok'), () => session.invalidate());

    const connectionFail = () => alert(t('common.unableToConnect'), t('common.retry'), () => load());

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
        rateLimit: defaultRateLimit('tcp'),
        // 이슈 348 FR-1: 새 터널은 켠 사람의 IP 만 받는 설정이 켜진 채 만든다.
        activatorIpOnly: true
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

    // U5-06: 레이트 리밋 입력은 초·분 단위로 보이고 저장할 때 밀리초로 바꾼다. 범위 밖이면 저장을 막는다(범위는 rateLimitRange.ts).
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

    const updatable = $derived(option ? ServerOptionCtrl.checkValidTunnelingOption(option) && validServerBuffer(option.bufferLimitOnServer) && rateValid
        && serverBufferIssue !== 'over' && clientBufferIssue !== 'over' && clientBufferIssue !== 'unlimited' : false);

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
            // 이슈 365: 칩이 건너뛸 포트. 목록에 보이는 다른 터널의 포트다(이 터널 자신은 뺀다).
            usedPorts = snapshot.value.map((row) => row.forwardPort).filter((port) => String(port) !== param);
            if(param === 'new') {
                const fresh = emptyOption();
                // 이슈 366 FR-11: 새 터널의 버퍼 기본값은 min(10, 그룹 상한)이다.
                fresh.bufferLimitOnServer = defaultBuffer(bufferCap);
                fresh.bufferLimitOnClient = defaultBuffer(bufferCap);
                storedBuffers = {};
                if(policy?.restricted) {
                    policy.normalizeHttpOption(fresh);
                    // 난수 포트는 대개 허용 범위 밖이라 처음부터 포트 오류가 보인다. 목록의 터널이 쓰지 않는 첫 허용 포트로 시작한다.
                    fresh.forwardPort = policy.initialPort(usedPorts) as number;
                    // 서버는 일반 유저의 빈 allowedClientIds 를 거부한다(빈 목록은 모든 클라이언트 허용과 같다).
                    // 그룹이 허용한 신뢰 클라이언트를 모두 고른 상태로 시작한다.
                    fresh.allowedClientIds = [...policy.trustedClients];
                }
                option = fresh;
                nameInput = '';
                sharedUsers = [];
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
            storedBuffers = {server: found.bufferLimitOnServer, client: found.bufferLimitOnClient};
            found.allowedClientNamesQuery = found.allowedClientNames?.join('; ');
            if(!found.allowedClientNamesQuery) found.allowedClientNamesQuery = '';
            else found.allowedClientNamesQuery += ';';
            if(!found.httpOption) found.httpOption = emptyOption().httpOption;
            // 서버가 늘 채워 주지만, 없으면 프로토콜 기본값으로 시작한다.
            if(!found.rateLimit) found.rateLimit = defaultRateLimit(found.protocol);
            option = found;
            nameInput = found.name ?? '';
            sharedUsers = found.sharedUsers ?? [];
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
            toast.push({tone: 'alarm', message: errorMessageOf(result)});
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
                toast.push({tone: 'alarm', message: errorMessageOf(result)});
                return;
            }
            snapshotRevision = result.revisionState.currentRevision;
            option.owner = result.owner;
            option.ownerId = result.owner.id;
            ownerId = result.owner.id;
            // 서버는 새 소유자를 공유 목록에서 뺀다(이슈 347). 칩도 맞춘다.
            sharedUsers = sharedUsers.filter((user) => user.id !== result.owner.id);
            toast.push({tone: 'pulse', message: t('tunnelEdit.ownerChanged')});
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
        nameError = '';
        const name = nameInput.trim();
        if(Array.from(name).length > NAME_MAX) {
            nameError = t('tunnelEdit.nameTooLong', {max: NAME_MAX});
            return;
        }
        if(name === '') delete option.name;
        else option.name = name;
        // 그룹 밖 id 가 남아 있으면 서버가 422 trusted_client_not_allowed 로 거부한다. 요청 전에 이유를 보인다.
        if(restricted && outsideGroupClientIds.length > 0) {
            trustedError = t('tunnelEdit.removeDisallowedIds');
            return;
        }
        // 고를 대상이 있을 때만 막는다. 그룹이 허용한 클라이언트가 없으면 서버가 순서대로 판정한다(포트 검사가 먼저다).
        if(restricted && policy!.trustedClients.length > 0 && (option.allowedClientIds ?? []).length === 0) {
            trustedError = t('tunnelEdit.selectTrustedClient');
            return;
        }
        loading = true;
        // 이슈 347: 공유 목록은 id 로만 보낸다. 서버가 중복·소유자를 빼고 없는 사용자를 거절한다.
        option.sharedUserIds = sharedUsers.map((user) => user.id);
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
                toast.push({tone: 'pulse', message: t('tunnelEdit.applied')});
                navigate('#/tunnels');
            } else {
                // 접두어는 유지한다(configuration-editor 테스트가 /Fail/ 로 기다린다).
                toast.push({tone: 'alarm', message: t('tunnel.applyFailed', {reason: errorMessageOf(result)})});
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
                toast.push({tone: 'pulse', message: t('tunnelEdit.removed')});
                navigate('#/tunnels');
            } else {
                toast.push({tone: 'alarm', message: t('tunnelEdit.removeFailed', {reason: errorMessageOf(result)})});
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
{#if !isNew}
    <TunnelStatusArea port={option.originalForwardPort ?? option.forwardPort} editable={toggleable} onsessionout={sessionOut} />
{/if}
{#if readOnly}
    <!-- 이슈 347: 켤 수는 있지만 고칠 수 없는 사용자(toggle 소유자·공유받은 사용자)에게는 켜고 끌 수 있다고 알린다. -->
    <p id="tunnel-readonly-note">{t(toggleable ? 'tunnelEdit.toggleOnlyNote' : 'tunnelEdit.readOnlyNote')}</p>
{/if}
<form class="tunnel-edit" onsubmit={(e) => e.preventDefault()}>
<!-- 읽기 전용이면 fieldset 이 안의 입력(부품·appender 포함)을 모두 비활성화한다. -->
<fieldset disabled={readOnly} style="border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: var(--s-4);">
    {#if !isNew && !restricted}
        <Card>
            <div class="form-stack">
                <Field label={t('tunnelEdit.owner')} for="tunnel-owner">
                    <div style="display: flex; gap: var(--s-2); align-items: center;">
                        <Select id="tunnel-owner" options={owners} bind:value={ownerId} />
                        <Button disabled={ownerId === (option.owner?.id ?? '')} onclick={() => (ownerOpen = true)}>{t('tunnelEdit.changeOwner')}</Button>
                    </div>
                </Field>
            </div>
        </Card>
    {/if}
    {#if canShare}
        <Card>
            <div class="form-stack">
                <Field label={t('tunnelEdit.sharedWith')} for="tunnel-share-input" hint={t('tunnelEdit.sharedWithHint')}>
                    <ShareUsersField bind:users={sharedUsers} ownerId={option.owner?.id ?? $me?.user.id} onsessionout={sessionOut} />
                </Field>
            </div>
        </Card>
    {/if}
    <Card>
        <div class="form-stack">
            <Field label={t('tunnelEdit.name')} for="input-name" hint={t('tunnelEdit.optional')} error={nameError || undefined}>
                <TextInput id="input-name" autocomplete="off" bind:value={nameInput} />
            </Field>
            <Field label={t('tunnelEdit.externalPort')} for="input-external-port" error={portError}>
                <NumberInput id="input-external-port" min={1} max={65535} bind:value={option.forwardPort}
                    oninput={(v) => (option!.forwardPort = clampPort(v) as number)} />
                {#if restricted}
                    <PortRangeChips ranges={policy!.portRanges} {usedPorts} hideNotes={!!portError} onpick={(port) => (option!.forwardPort = port)} />
                {/if}
            </Field>
            <Checkbox id="input-tls" label={t('tunnelEdit.secureTunneling')} bind:checked={option.tls}
                disabled={option.protocol !== 'tcp'} onchange={() => onChangeSecureTunneling(option!.forwardPort)} />
            {#if option.tls === true}
                {#if restricted}
                    <p id="tunnel-cert-note">{t('tunnelEdit.generatedCert')}</p>
                {:else}
                    <div id="tunnel-cert">
                        <InputCertFile certInfo={option.certInfo} hideMessage={true} onupdate={(value) => (option!.certInfo = value)} />
                    </div>
                {/if}
                <Field label={t('tunnelEdit.destinationCert')}
                    hint={t('tunnelEdit.destinationCertHint')}>
                    <!-- 옛 설정에는 이 값이 없어 undefined 다. 기본값이 있는 bind 는 undefined 를 받지 못하므로 함수 바인딩을 쓴다. -->
                    <Checkbox id="input-allow-self-signed" label={t('tunnelEdit.skipVerification')}
                        bind:checked={() => option!.allowSelfSignedDestinationCert === true, (on) => (option!.allowSelfSignedDestinationCert = on)} />
                </Field>
            {/if}
            <Field label={t('tunnelEdit.destinationHost')} for="input-destination-host">
                <TextInput id="input-destination-host" bind:value={option.destinationAddress} />
            </Field>
            <Field label={t('tunnelEdit.destinationPort')} for="input-destination-port">
                <NumberInput id="input-destination-port" min={1} max={65535} bind:value={option.destinationPort}
                    oninput={(v) => (option!.destinationPort = clampPort(v) as number)} />
            </Field>
            {#if restricted}
                <Field label={t('tunnelEdit.trustedClientIds')} error={trustedError || undefined}>
                    <div style="display: flex; flex-wrap: wrap; gap: var(--s-4);">
                        {#each restrictedClientIds as clientId (clientId)}
                            <Checkbox id={`tunnel-trusted-${clientId}`}
                                label={loadedOutsideIds.includes(clientId) ? t('tunnelEdit.clientNotAllowed', {clientId}) : clientId}
                                bind:checked={() => trusted(clientId), (on) => setTrusted(clientId, on)} />
                        {:else}
                            <p>{t('tunnelEdit.noTrustedClientsForGroup')}</p>
                        {/each}
                    </div>
                </Field>
                {#if outsideGroupClientIds.length > 0}
                    <p id="tunnel-trusted-not-allowed" role="note" style="margin: 0; color: var(--alarm);">{t('tunnelEdit.groupDisallows', {ids: outsideGroupClientIds.join(', ')})}</p>
                {/if}
            {:else}
                <Field label={t('tunnelEdit.trustedClientIds')}>
                    <div style="display: flex; flex-wrap: wrap; gap: var(--s-4);">
                        {#each superuserClientIds as clientId (clientId)}
                            <Checkbox id={`tunnel-client-id-${clientId}`} label={allTrustedClients.find((c) => c.clientId === clientId)?.displayName ?? clientId}
                                bind:checked={() => option!.allowedClientIds?.includes(clientId) === true, (on) => setSuperuserClientId(clientId, on)} />
                        {:else}
                            <p>{t('group.noTrustedClients')}</p>
                        {/each}
                    </div>
                </Field>
                <Field label={t('tunnelEdit.allowedClientNames')} for="input-allow-client-names">
                    <TextInput id="input-allow-client-names" bind:value={option.allowedClientNamesQuery} />
                </Field>
                {#if groupsUnavailable && (option.allowedClientIds ?? []).length > 0}
                    <p id="tunnel-client-ids-owner-unknown" role="note" style="margin: 0; color: var(--ink-2);">{t('tunnelEdit.ownerGroupUnknown')}</p>
                {/if}
                {#if notAllowedForOwner.length > 0}
                    <p id="tunnel-client-ids-not-allowed" role="alert" style="margin: 0; color: var(--alarm);">{t('tunnelEdit.ownerGroupDisallows', {ids: notAllowedForOwner.join(', ')})}</p>
                {/if}
                {#if (option.allowedClientIds ?? []).length > 0}
                    <p id="tunnel-client-ids-priority" role="note" style="margin: 0; color: var(--ink-2);">{t('tunnelEdit.idsOverrideNames')}</p>
                {/if}
            {/if}
            <Field label={t('tunnelEdit.keepAlive')} for="input-active-timeout">
                <!-- 새 터널에는 keepAlive 가 없다. 그대로 bind 하면 fallback 이 있는 prop 에 undefined 가 들어가 Svelte 가 거부하므로,
                     읽기는 null 로 바꾸고 쓰기는 빈 값을 다시 undefined 로 되돌려 옛 저장 본문과 같은 모양을 지킨다. -->
                <NumberInput id="input-active-timeout"
                    bind:value={() => option!.keepAlive ?? null, (value) => (option!.keepAlive = value ?? undefined)} />
            </Field>
        </div>
    </Card>
    <Card label={t('tunnelEdit.bufferLimit')}>
        {#if bufferCap !== null}
            <!-- 이슈 366 FR-10: 상한은 입력하기 전부터 보인다. -->
            <p id="tunnel-buffer-cap" class="buffer-cap">{t('tunnelEdit.groupBufferMax', {max: bufferCap})}</p>
        {/if}
        <div class="two-col">
            <Field label={t('tunnelEdit.server')} for="input-buffer-limit-server"
                error={!validServerBuffer(option.bufferLimitOnServer) ? t('tunnelEdit.serverBufferInvalid')
                    : serverBufferIssue === 'over' ? t('tunnelEdit.bufferOverGroup', {max: bufferCap ?? 0}) : undefined}>
                <NumberInput id="input-buffer-limit-server" min={1} max={bufferMaxAttr(serverBufferIssue)} step="any"
                    invalid={!validServerBuffer(option.bufferLimitOnServer) || serverBufferIssue === 'over'} bind:value={option.bufferLimitOnServer} />
            </Field>
            <Field label={t('tunnelEdit.client')} for="input-buffer-limit-client"
                error={clientBufferIssue === 'over' ? t('tunnelEdit.bufferOverGroup', {max: bufferCap ?? 0})
                    : clientBufferIssue === 'unlimited' ? t('tunnelEdit.bufferUnlimitedUnderGroup', {max: bufferCap ?? 0}) : undefined}>
                <NumberInput id="input-buffer-limit-client" max={bufferMaxAttr(clientBufferIssue)} bind:value={option.bufferLimitOnClient}
                    invalid={clientBufferIssue === 'over' || clientBufferIssue === 'unlimited'}
                    oninput={(v) => (option!.bufferLimitOnClient = clampClientBuffer(v) as number)} />
            </Field>
        </div>
        {#if storedOverLines.length > 0}
            <!-- 이슈 366 FR-12: 이미 상한을 넘은 기존 값은 그대로 저장할 수 있다. 칸마다 한 줄씩 경고만 한다. -->
            <div id="tunnel-buffer-stored-over" class="buffer-warn" role="status">
                {#each storedOverLines as line (line.id)}
                    <p id="tunnel-buffer-stored-over-{line.id}">{line.text}</p>
                {/each}
            </div>
        {/if}
        <ul class="notes">
            <li>{t('tunnelEdit.serverBufferNote')}</li>
            <li>{bufferCap !== null ? t('tunnelEdit.clientBufferCapNote', {max: bufferCap}) : t('tunnelEdit.clientBufferNote')}</li>
            <li>{t('tunnelEdit.spillNote')}</li>
        </ul>
    </Card>
    <Card>
        <div class="form-stack">
            <Field label={t('tunnelEdit.protocol')} for="select-protocol">
                <Select id="select-protocol" options={protocolOptions} bind:value={option.protocol} onchange={onChangeProtocol} />
            </Field>
            {#if option.rateLimit}
                <Card label={t('tunnelEdit.rateLimit')}>
                    <div class="form-stack">
                        <!-- 스위치도 사용자가 고친 값이다(D9). 끈 뒤 프로토콜을 바꿔도 기본값으로 되돌리지 않는다. -->
                        <Switch ariaLabel={t('tunnelEdit.rateLimitEnabled')} disabled={readOnly} bind:on={option.rateLimit.enabled}
                            onchange={() => { if(option?.rateLimit) option.rateLimit.customized = true; }} />
                        <Field label={t('tunnelEdit.window')} for="input-rate-window" error={!rateTouched.window || inRange(rateWindow, RATE_RANGES.window) ? undefined : rateRangeError(RATE_RANGES.window)}>
                            <NumberInput id="input-rate-window" min={1} max={3600} invalid={rateTouched.window && !inRange(rateWindow, RATE_RANGES.window)}
                                bind:value={rateWindow} oninput={() => onRateInput('window')} />
                        </Field>
                        <Field label={t('tunnelEdit.maxPerIp')} for="input-rate-max" error={!rateTouched.max || inRange(rateMax, RATE_RANGES.max) ? undefined : rateRangeError(RATE_RANGES.max)}>
                            <NumberInput id="input-rate-max" min={1} max={100000} invalid={rateTouched.max && !inRange(rateMax, RATE_RANGES.max)}
                                bind:value={rateMax} oninput={() => onRateInput('max')} />
                        </Field>
                        <Field label={t('tunnelEdit.banDuration')} for="input-rate-ban" error={!rateTouched.ban || inRange(rateBan, RATE_RANGES.ban) ? undefined : rateRangeError(RATE_RANGES.ban)}>
                            <NumberInput id="input-rate-ban" min={1} max={1440} invalid={rateTouched.ban && !inRange(rateBan, RATE_RANGES.ban)}
                                bind:value={rateBan} oninput={() => onRateInput('ban')} />
                        </Field>
                        <p class="notes" style="margin: 0; padding: 0; list-style: none;">{t('tunnelEdit.rateLimitNote')}</p>
                    </div>
                </Card>
            {/if}
            {#if (option.protocol === 'http' || option.protocol === 'https') && (policy?.showHttpOptions ?? true)}
                <h2 class="section-title">{t('tunnelEdit.httpOptions')}</h2>
                {#if policy?.rewrite.host ?? true}
                    <Field label={t('tunnelEdit.replaceHost')} for="select-change-host-in-body">
                        <Select id="select-change-host-in-body" options={ENABLED}
                            value={String(option.httpOption.rewriteHostInTextBody ?? true)}
                            onchange={(v) => (option!.httpOption.rewriteHostInTextBody = v === 'true')} />
                    </Field>
                {/if}
                {#if policy?.rewrite.cors ?? true}
                    <Field label={t('tunnelEdit.replaceAcao')} for="select-change-acao">
                        <Select id="select-change-acao" options={ENABLED}
                            value={String(option.httpOption.replaceAccessControlAllowOrigin ?? false)}
                            onchange={(v) => (option!.httpOption.replaceAccessControlAllowOrigin = v === 'true')} />
                    </Field>
                {/if}
                {#if policy?.rewrite.header ?? true}
                    <div id="http-request-headers">
                        <Field label={t('tunnelEdit.injectRequestHeader')}>
                            <HeaderAppender bind:options={option.httpOption.customRequestHeaders} />
                        </Field>
                    </div>
                    <div id="http-response-headers">
                        <Field label={t('tunnelEdit.injectResponseHeader')}>
                            <HeaderAppender bind:options={option.httpOption.customResponseHeaders} />
                        </Field>
                    </div>
                {/if}
                {#if policy?.rewrite.body ?? true}
                    <div id="http-body-rewrite">
                        <Field label={t('tunnelEdit.replaceBody')}>
                            <BodyReplaceAppender bind:options={option.httpOption.bodyRewriteRules} />
                        </Field>
                    </div>
                {/if}
            {/if}
            <Field label={t('tunnelEdit.startup')}
                hint={t('tunnelEdit.startupHint')}>
                <Checkbox id="input-inactive-on-startup" label={t('tunnelEdit.inactiveOnStartup')} bind:checked={option.inactiveOnStartup} />
            </Field>
            <Field label={t('tunnelEdit.allowedIp')}
                hint={t('tunnelEdit.allowedIpHint')}>
                <!-- 이슈 348 FR-19: 옛 터널은 서버가 false 로 준다. 함수 바인딩으로 undefined 도 꺼짐으로 받는다. -->
                <Checkbox id="input-activator-ip-only" label={t('tunnelEdit.activatorIpOnly')}
                    bind:checked={() => option!.activatorIpOnly === true, (on) => (option!.activatorIpOnly = on)} />
            </Field>
        </div>
    </Card>
</fieldset>
</form>
{#if !readOnly}
<div class="edit-bar">
    <Button variant="primary" disabled={!updatable} onclick={apply}>{t(option.isSync ? 'tunnelEdit.applyAndRestart' : 'tunnelEdit.start')}</Button>
    {#if option.isSync}
        <Button variant="danger" onclick={() => (confirmOpen = true)}>{t('tunnelEdit.stopAndRemove')}</Button>
    {/if}
</div>
{/if}
<Modal bind:open={ownerOpen} title={t('tunnelEdit.changeOwner')}>
    {t('tunnelEdit.moveConfirm', {port: option.forwardPort, owner: ownerLabel})}
    {#snippet footer()}
        <Button onclick={() => (ownerOpen = false)}>{t('common.cancel')}</Button>
        <Button variant="primary" onclick={() => { void reassign(); }}>{t('tunnelEdit.move')}</Button>
    {/snippet}
</Modal>
<Modal bind:open={confirmOpen} title={t('tunnelEdit.removeTitle')}>
    {t('tunnelEdit.removeConfirm', {port: option.forwardPort})}
    {#snippet footer()}
        <Button onclick={() => (confirmOpen = false)}>{t('common.cancel')}</Button>
        <Button variant="danger" onclick={() => { confirmOpen = false; remove(); }}>{t('common.remove')}</Button>
    {/snippet}
</Modal>
{/if}
{#if loading}<Loading overlay />{/if}
<Modal bind:open={alertOpen} title={t('tunnelEdit.alertTitle')}>
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
    .buffer-cap { margin: 0 0 var(--s-3); font-family: var(--ff-mono); font-size: var(--fs-xs); color: var(--ink-1); }
    .buffer-warn { margin: var(--s-3) 0 0; font-size: var(--fs-xs); color: var(--warn); }
    .buffer-warn p { margin: 0; }
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
