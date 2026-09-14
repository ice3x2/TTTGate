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
    import TextInput from '../ui/TextInput.svelte';
    import {useSession} from '../shell/session';
    import InputCertFile from './parts/InputCertFile.svelte';

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
    // NumberInput 은 숫자로 바꾼 값만 넘기는데, 그 숫자를 다시 문자열화하면 1e23 처럼 지수 표기가 되어
    // parseInt 가 1 을 내므로 원문을 입력란에서 직접 읽는다.
    const enforceMinMax = (id: string, value: number | null, min: number, max: number): number | null => {
        const raw = (document.getElementById(id) as HTMLInputElement).value;
        if(raw == '') return value;
        if(parseInt(raw) < min) return min;
        if(parseInt(raw) > max) return max;
        // 옛 판정과 의도적으로 다른 부분: 원문이 1e5·1e-7 같은 지수 표기면 parseInt 가 1 로 읽어 범위 밖 값을
        // 통과시켰다. 숫자 값의 정수부로 한 번 더 비교해 그 경우만 막는다. 정수부로 비교하므로 -0.5(정수부 -0)는
        // 옛 판정처럼 그대로 남고, 지수 표기가 아닌 입력은 첫 판정과 같은 결과를 낸다.
        if(value !== null && Math.trunc(value) < min) return min;
        if(value !== null && Math.trunc(value) > max) return max;
        return value;
    };

    const adminAddress = () => `${serverOption.adminTls ? 'https' : 'http'}://${location.hostname}:${serverOption.adminPort}/`;

    const load = async () => {
        try {
            loading = true;
            const snapshot = await ServerOptionCtrl.instance.getServerOption();
            serverOption = snapshot.value;
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
                <NumberInput id="input-keep-alive" min={1} max={99999} bind:value={serverOption.keepAlive}
                    oninput={(v) => (serverOption.keepAlive = enforceMinMax('input-keep-alive', v, 1, 99999) as number)} />
            </Field>
        </div>
    </Card>
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
