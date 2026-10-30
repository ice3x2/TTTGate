<script lang="ts">
    import {onMount} from 'svelte';
    import _ from 'lodash';
    import ServerOptionCtrl from '../controller/ServerOptionCtrl';
    import CertificationCtrl from '../controller/CertificationCtrl';
    import ObjectUtil from '../controller/ObjectUtil';
    import InvalidSession from '../controller/InvalidSession';
    import type {CertInfo, ServerOption} from '../controller/Types';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Checkbox from '../ui/Checkbox.svelte';
    import Field from '../ui/Field.svelte';
    import Loading from '../ui/Loading.svelte';
    import Modal from '../ui/Modal.svelte';
    import NumberInput from '../ui/NumberInput.svelte';
    import Select from '../ui/Select.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {useSession} from '../shell/session';
    import InputCertFile from './parts/InputCertFile.svelte';

    // U4-09: 서버가 값을 아직 저장하지 않았을 때 보이는 기본값(서버 src/types/TunnelingOption.ts 와 같다).
    const DEFAULT_AUDIT_RETENTION_DAYS = 90;
    const DEFAULT_AUDIT_QUEUE_SIZE = 1000;
    // 이슈 268: 닫기 기한의 서버 기본값과 범위(서버 TunnelingOption 과 같다).
    const DEFAULT_CLOSE_STALL_MS = 60000;
    const DEFAULT_CLOSE_GRACE_MS = 10000;
    // 이슈 267: 서버 로그 레벨(서버 LOG_LEVELS 와 같은 순서). 값이 없는 설정(새로 만든 기본값 포함)은 info 다.
    // 주석에 '#' 과 숫자를 붙여 쓰지 않는다. design-system-rules 의 hex 색상 검사가 색으로 읽는다.
    // 저장값이 없을 때 info 를 고르면 바뀐 것이 없으므로 키를 지운다(undefined 로 두면 깊은 비교가 다르다고 본다).
    // 그래야 Apply 가 켜지지 않는다.
    const setLogLevel = (value: string) => {
        if(value === 'info' && lastServerOption.logLevel === undefined) delete serverOption.logLevel;
        else serverOption.logLevel = value as ServerOption['logLevel'];
    };
    const LOG_LEVEL_OPTIONS = [
        {value: 'error', label: 'error'}, {value: 'warn', label: 'warn'},
        {value: 'info', label: 'info'}, {value: 'debug', label: 'debug'},
    ];
    // 입력 칸은 별도 상태다. 칸을 비워도 기본값이 다시 들어오지 않게, 불러올 때와 Reset 때만 서버 값(없으면 기본값)으로 맞춘다.
    let retentionInput = $state<number | null>(DEFAULT_AUDIT_RETENTION_DAYS);
    let queueInput = $state<number | null>(DEFAULT_AUDIT_QUEUE_SIZE);
    // 빈 감사 칸 오류. 빈칸은 JSON 에서 빠져 서버 기본값(보존 90일)이 되므로 저장을 막는다.
    let auditErrors = $state<{retention?: string; queue?: string}>({});
    // 이슈 268: 닫기 기한 칸도 같은 방식이다. 빈칸이면 기본값으로 조용히 돌아가지 않게 저장을 막는다.
    let closeStallInput = $state<number | null>(DEFAULT_CLOSE_STALL_MS);
    let closeGraceInput = $state<number | null>(DEFAULT_CLOSE_GRACE_MS);
    let closeErrors = $state<{stall?: string; grace?: string}>({});

    const syncSecurityInputs = () => {
        retentionInput = serverOption.auditRetentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS;
        queueInput = serverOption.auditQueueSize ?? DEFAULT_AUDIT_QUEUE_SIZE;
        auditErrors = {};
        closeStallInput = serverOption.closeStallMs ?? DEFAULT_CLOSE_STALL_MS;
        closeGraceInput = serverOption.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS;
        closeErrors = {};
    };
    let serverOption = $state<ServerOption>(ServerOptionCtrl.instance.getCachedServerOption());
    let lastServerOption = $state<ServerOption>(ServerOptionCtrl.instance.getCachedServerOption());
    let adminCert = $state<CertInfo | null>(null);
    let lastAdminCert = $state<CertInfo | null>(null);
    let originalAdminCert = $state<CertInfo | null>(null);
    let snapshotRevision: number;
    let loading = $state(false);

    let alertOpen = $state(false);
    let alertMessage = $state('');
    let alertButton = $state('OK');
    let alertClose = $state<() => void>(() => {});

    const session = useSession();

    const isNewValue = $derived(!ObjectUtil.equalsDeep(serverOption, lastServerOption)
        || adminCert == null || lastAdminCert == null || !ObjectUtil.equalsDeep(adminCert, lastAdminCert));

    const alert = (message: string, button = 'OK', onClose?: () => void) => {
        alertMessage = message;
        alertButton = button;
        alertClose = onClose ?? (() => {});
        alertOpen = true;
    };

    const sessionOut = () => alert('Session is expired. Please login again.', 'OK', () => session.invalidate());

    // 옛 _enforceMinMax 처럼 입력란의 원문 문자열에 parseInt 를 적용해 범위와 비교한다. 빈 값은 그대로 둔다.
    // NumberInput 은 숫자로 바꾼 값만 넘기는데, 그 숫자를 다시 문자열화하면 원문과 다른 문자열이 되어
    // 판정이 달라진다(70000e-1 은 7000 이 되어 잘리지 않는다). 그래서 원문을 입력란에서 직접 읽는다.
    const enforceMinMax = (id: string, value: number | null, min: number, max: number): number | null => {
        const raw = (document.getElementById(id) as HTMLInputElement).value;
        if(raw == '') return value;
        if(parseInt(raw) < min) return min;
        if(parseInt(raw) > max) return max;
        // 옛 판정과 의도적으로 다른 부분: 옛 판정은 원문의 parseInt 만 보므로 1e5·.5·99999.99999999999999999 처럼
        // 원본이 범위 밖 값을 통과시키던 입력이 있었다. 숫자 값의 정수부로 한 번 더 비교해, 그 가운데 정수부가
        // 범위를 벗어난 입력만 범위 안으로 넣는다. min·max 가 정수이므로 정수부가 범위 밖이면 값도 범위 밖이고,
        // 그래서 원본이 범위 안의 결과를 내던 입력은 바뀌지 않는다. -0.5 는 정수부가 -0 이라 옛 판정처럼 남는다.
        if(value !== null && Math.trunc(value) < min) return min;
        if(value !== null && Math.trunc(value) > max) return max;
        return value;
    };

    const keepAliveOf = (value: number | null): number | null => value === null ? null : Math.max(0, Math.trunc(value));

    const adminAddress = () => `${serverOption.adminTls ? 'https' : 'http'}://${location.hostname}:${serverOption.adminPort}/`;

    const load = async () => {
        try {
            loading = true;
            const snapshot = await ServerOptionCtrl.instance.getServerOption();
            serverOption = snapshot.value;
            syncSecurityInputs();
            snapshotRevision = snapshot.revision;
            await ServerOptionCtrl.instance.getServerOptionHash();
            lastServerOption = _.cloneDeep($state.snapshot(serverOption));
            adminCert = await CertificationCtrl.instance.loadAdminCert();
            lastAdminCert = _.cloneDeep($state.snapshot(adminCert));
            originalAdminCert = _.cloneDeep($state.snapshot(adminCert));
            loading = false;
        } catch(e) {
            console.error(e);
            if(e instanceof InvalidSession) {
                sessionOut();
                return;
            }
            alert('Unable to connect to the server.', 'OK', () => {
                location.href = '/';
            });
        }
    };

    const updateAdminCert = async (newAdminCert: CertInfo) => {
        loading = true;
        try {
            const result = await CertificationCtrl.instance.updateAdminCert(newAdminCert);
            if(result.success) {
                lastAdminCert = adminCert;
                adminCert = newAdminCert;
            } else {
                alert(result.message);
            }
            loading = false;
        } catch(e) {
            console.error(e);
            if(e instanceof InvalidSession) {
                loading = false;
                sessionOut();
            } else {
                alert('Unable to connect to the server.', 'Retry', async () => {
                    await updateAdminCert(newAdminCert);
                });
            }
        }
    };

    const apply = async () => {
        auditErrors = {
            ...(retentionInput == null ? {retention: 'Enter a number of days. 0 keeps logs forever.'} : {}),
            ...(queueInput == null ? {queue: 'Enter a queue size.'} : {})
        };
        closeErrors = {
            ...(closeStallInput == null ? {stall: 'Enter a time in milliseconds (1000-600000).'} : {}),
            ...(closeGraceInput == null ? {grace: 'Enter a time in milliseconds (1000-120000).'} : {})
        };
        if(Object.keys(auditErrors).length > 0 || Object.keys(closeErrors).length > 0) return;
        try {
            loading = true;
            const result = await ServerOptionCtrl.instance.updateServerOption($state.snapshot(serverOption), snapshotRevision);
            loading = false;
            if(result.success) {
                await checkServerRestart();
            } else {
                alert(result.message);
            }
        } catch(e) {
            console.error(e);
            loading = false;
            if(e instanceof InvalidSession) {
                sessionOut();
            } else {
                alert('Unable to connect to the server.', 'Retry', async () => {
                    await apply();
                });
            }
        }
    };

    const checkServerRestart = async () => {
        loading = true;
        let success = false;
        try {
            success = await ServerOptionCtrl.instance.checkChangeServerOption($state.snapshot(lastServerOption), $state.snapshot(serverOption));
        } catch(e) {
            alert(`Error: Server status could not be determined.${serverOption.adminTls ? '(It could be a TSL certificate error.)' : ''}`, 'OK', () => {
                location.href = adminAddress();
            });
            return;
        }
        loading = false;
        if(success) {
            alert('Server settings have been changed. The server has been restarted.', 'OK', () => {
                lastServerOption = _.cloneDeep($state.snapshot(serverOption));
                lastAdminCert = _.cloneDeep($state.snapshot(adminCert));
                originalAdminCert = _.cloneDeep($state.snapshot(adminCert));
                location.href = adminAddress();
            });
        } else {
            alert('New server options cannot be applied.', 'OK', () => {
                serverOption = _.cloneDeep($state.snapshot(lastServerOption));
                adminCert = _.cloneDeep($state.snapshot(originalAdminCert));
                lastAdminCert = _.cloneDeep($state.snapshot(adminCert));
                location.href = '/';
            });
        }
    };

    const reset = () => {
        const isChangedCert = !ObjectUtil.equalsDeep(adminCert, originalAdminCert);
        serverOption = _.cloneDeep($state.snapshot(lastServerOption));
        syncSecurityInputs();
        adminCert = _.cloneDeep($state.snapshot(originalAdminCert));
        if(isChangedCert) {
            updateAdminCert(adminCert!);
        }
    };

    onMount(() => {
        load();
    });
</script>

<div class="server-settings">
    <Card>
        <div class="form-stack">
            <Field label="Tunnel server-client authentication key" for="input-key">
                <TextInput id="input-key" bind:value={serverOption.key} />
            </Field>
            <Field label="Admin service port number" for="input-admin-port">
                <NumberInput id="input-admin-port" min={0} max={65535} bind:value={serverOption.adminPort}
                    oninput={(v) => (serverOption.adminPort = enforceMinMax('input-admin-port', v, 0, 65535) as number)} />
            </Field>
            <Checkbox id="input-admin-tls" label="Admin TLS" bind:checked={serverOption.adminTls} />
            {#if serverOption.adminTls}<InputCertFile certInfo={adminCert} onupdate={updateAdminCert} />{/if}
            <Field label="Tunnel server port number" for="input-tunnel-port">
                <NumberInput id="input-tunnel-port" min={0} max={65535} bind:value={serverOption.port}
                    oninput={(v) => (serverOption.port = enforceMinMax('input-tunnel-port', v, 0, 65535) as number)} />
            </Field>
            <Checkbox id="input-tunnel-tls" label="Tunnel TLS" bind:checked={serverOption.tls} />
            <Field label="Memory cache limit (MiB)" for="input-mem-cache-limit">
                <NumberInput id="input-mem-cache-limit" min={1} max={99999} bind:value={serverOption.globalMemCacheLimit}
                    oninput={(v) => (serverOption.globalMemCacheLimit = enforceMinMax('input-mem-cache-limit', v, 1, 99999) as number)} />
            </Field>
            <Field label="Keep-Alive (ms)" for="input-keep-alive" hint="0 or less disables keep-alive.">
                <!-- 문구대로 0 은 keep-alive 를 끈다(서버는 keepAlive > 0 일 때만 켠다). ms 단위라 정수로 자르고, 음수(-0.5 포함)는 0 으로 올린다. -->
                <NumberInput id="input-keep-alive" min={0} max={99999} bind:value={serverOption.keepAlive}
                    oninput={(v) => (serverOption.keepAlive = keepAliveOf(enforceMinMax('input-keep-alive', v, 0, 99999)) as number)} />
            </Field>
            <Field label="Log level" for="input-log-level" hint="Applies to all server logs right away. debug is verbose.">
                <Select id="input-log-level" options={LOG_LEVEL_OPTIONS}
                    bind:value={() => serverOption.logLevel ?? 'info', setLogLevel} />
            </Field>
        </div>
    </Card>
    <!-- U4-09: 슈퍼유저 MFA 강제와 감사 보존·큐. 기존 isNewValue·Apply·Reset 흐름을 그대로 탄다. -->
    <section id="server-security">
        <Card label="Security">
            <div class="form-stack">
                <Checkbox id="input-mfa-required-superusers" label="Require two-factor for superusers"
                    bind:checked={() => serverOption.mfaRequiredForSuperusers === true, (value) => (serverOption.mfaRequiredForSuperusers = value)} />
                <Field label="Audit log retention (days)" hint="0 keeps logs forever." for="input-audit-retention-days" error={auditErrors.retention}>
                    <NumberInput id="input-audit-retention-days" min={0} max={3650} step={1}
                        bind:value={retentionInput} oninput={(value) => (serverOption.auditRetentionDays = value ?? undefined)} />
                </Field>
                <Field label="Audit queue size" for="input-audit-queue-size" error={auditErrors.queue}>
                    <NumberInput id="input-audit-queue-size" min={100} max={100000} step={1}
                        bind:value={queueInput} oninput={(value) => (serverOption.auditQueueSize = value ?? undefined)} />
                </Field>
            </div>
        </Card>
    </section>
    <!-- 이슈 268: 닫기를 시작한 연결의 기한. 바꾸면 이후 닫는 연결부터 적용된다. -->
    <section id="server-connection-close">
        <Card label="Connection close">
            <div class="form-stack">
                <Field label="Close stall timeout (ms)" for="input-close-stall-ms" error={closeErrors.stall}
                    hint="Time the remaining output can make no progress before the connection is closed. 1000-600000. Applies to connections that start to close after you apply.">
                    <NumberInput id="input-close-stall-ms" min={1000} max={600000} step={1000}
                        bind:value={closeStallInput} oninput={(value) => (serverOption.closeStallMs = value ?? undefined)} />
                </Field>
                <Field label="Close grace timeout (ms)" for="input-close-grace-ms" error={closeErrors.grace}
                    hint="Time to wait for the peer to close after FIN. 1000-120000. Applies to connections that send or receive FIN after you apply.">
                    <NumberInput id="input-close-grace-ms" min={1000} max={120000} step={1000}
                        bind:value={closeGraceInput} oninput={(value) => (serverOption.closeGraceMs = value ?? undefined)} />
                </Field>
            </div>
        </Card>
    </section>
    <div class="actions">
        <Button variant="primary" disabled={!isNewValue} onclick={apply}>Apply</Button>
        <Button onclick={reset}>Reset</Button>
    </div>
    {#if loading}<Loading overlay />{/if}
    <Modal bind:open={alertOpen} title="Server settings">
        {alertMessage}
        {#snippet footer()}
            <Button variant="primary" onclick={() => { alertOpen = false; alertClose(); }}>{alertButton}</Button>
        {/snippet}
    </Modal>
</div>

<style>
    .server-settings { display: flex; flex-direction: column; gap: var(--s-4); }
    .form-stack { display: flex; flex-direction: column; gap: var(--s-4); }
    .actions { display: flex; gap: var(--s-3); justify-content: flex-end; }
</style>
