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

    // 옛 _enforceMinMax 와 같다. 정수부로 비교하므로 -0.5 는 0 보다 작다고 보지 않는다. 빈 값은 그대로 둔다.
    const clamp = (value: number | null, min: number, max: number): number | null => {
        if(value === null) return value;
        if(parseInt(String(value)) < min) return min;
        if(parseInt(String(value)) > max) return max;
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
                    oninput={(v) => (serverOption.adminPort = clamp(v, 0, 65535) as number)} />
            </Field>
            <Checkbox id="input-admin-tls" label="Admin TLS" bind:checked={serverOption.adminTls} />
            {#if serverOption.adminTls}<InputCertFile certInfo={adminCert} onupdate={updateAdminCert} />{/if}
            <Field label="Tunnel server port number" for="input-tunnel-port">
                <NumberInput id="input-tunnel-port" min={0} max={65535} bind:value={serverOption.port}
                    oninput={(v) => (serverOption.port = clamp(v, 0, 65535) as number)} />
            </Field>
            <Checkbox id="input-tunnel-tls" label="Tunnel TLS" bind:checked={serverOption.tls} />
            <Field label="Memory cache limit (MiB)" for="input-mem-cache-limit">
                <NumberInput id="input-mem-cache-limit" min={1} max={99999} bind:value={serverOption.globalMemCacheLimit}
                    oninput={(v) => (serverOption.globalMemCacheLimit = clamp(v, 1, 99999) as number)} />
            </Field>
            <Field label="Keep-Alive (ms)" for="input-keep-alive" hint="0 or less disables keep-alive.">
                <NumberInput id="input-keep-alive" min={1} max={99999} bind:value={serverOption.keepAlive}
                    oninput={(v) => (serverOption.keepAlive = clamp(v, 1, 99999) as number)} />
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
