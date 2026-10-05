<script lang="ts">
    import {onMount} from 'svelte';
    import CertificationCtrl from '../controller/CertificationCtrl';
    import InvalidSession from '../controller/InvalidSession';
    import type {Options} from '../controller/Options';
    import ServerOptionCtrl from '../controller/ServerOptionCtrl';
    import type {CertInfo} from '../controller/Types';
    import {navigate} from '../router';
    import {useSession} from '../shell/session';
    import Button from '../ui/Button.svelte';
    import Card from '../ui/Card.svelte';
    import Checkbox from '../ui/Checkbox.svelte';
    import Field from '../ui/Field.svelte';
    import Loading from '../ui/Loading.svelte';
    import Modal from '../ui/Modal.svelte';
    import NumberInput from '../ui/NumberInput.svelte';
    import Select from '../ui/Select.svelte';
    import TextInput from '../ui/TextInput.svelte';
    import {toast} from '../ui/toast';
    import BodyReplaceAppender from './parts/BodyReplaceAppender.svelte';
    import HeaderAppender from './parts/HeaderAppender.svelte';
    import InputCertFile from './parts/InputCertFile.svelte';

    // ??layout/TunnelOptionSetLayout.svelte 21?됱쓽 ?뺤쓽 洹몃?濡쒕떎.
    type TunnelingOptionEx = Options & {updatable?: boolean, isSync?: boolean, certInfo?: CertInfo, certificateRevision?: number,
        originalCertificateRevision?: number, originalForwardPort?: number, allowedClientNamesQuery?: string, activeTimeout?: number};

    let {param}: {param: string} = $props();

    const PROTOCOLS = [{value: 'tcp', label: 'TCP'}, {value: 'http', label: 'HTTP (http/1.1)'}, {value: 'https', label: 'HTTPS (http/1.1)'}];
    const ENABLED = [{value: 'true', label: 'Enabled'}, {value: 'false', label: 'Disabled'}];

    let option = $state<TunnelingOptionEx | undefined>();
    let snapshotRevision = 0;
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

    // ??_addEmptyOption(200~228????媛?洹몃?濡쒕떎.
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
        allowedClientNamesQuery: ''
    });

    // ??_validServerBuffer(86?? 洹몃?濡쒕떎.
    const validServerBuffer = (value: unknown): boolean =>
        typeof value === 'number' && Number.isFinite(value) && value >= 1 && Number.isFinite(value * 1024 * 1024);

    // ??_normalizePortNumber(65~73??쨌_normalizeMemBufferSize(75~83?? 瑜??낅젰 ?쒖젏?쇰줈 ??릿 寃껋씠??
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

    const updatable = $derived(option ? ServerOptionCtrl.checkValidTunnelingOption(option) && validServerBuffer(option.bufferLimitOnServer) : false);

    // ??_loadCertInfo(134~156?? 洹몃?濡쒕떎. ??肄붾뱶???ы듃濡??됱쓣 李얠븘 ?놁쑝硫??뚯븘媛붾떎.
    const loadCertInfo = async (port: number) => {
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

    // ??_loadTunnelingOption(96~124???먯꽌 ???붾㈃???ㅻ（?????됰쭔 ?④릿 寃껋씠??
    const load = async () => {
        try {
            loading = true;
            const snapshot = await ServerOptionCtrl.instance.getTunnelingOption();
            snapshotRevision = snapshot.revision;
            if(param === 'new') {
                option = emptyOption();
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
            option = found;
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

    // ??_onChangeSecureTunneling(344~351?? 洹몃?濡쒕떎.
    const onChangeSecureTunneling = async (forwardPort: number) => {
        if(!option) return;
        await loadCertInfo(forwardPort);
    };

    // ??_onChangeProtocol(233~242?? 洹몃?濡쒕떎.
    const onChangeProtocol = () => {
        if(!option) return;
        if(option.protocol == 'https') {
            const old = option.tls;
            option.tls = true;
            if(!old) onChangeSecureTunneling(option.forwardPort);
        } else {
            option.tls = false;
        }
    };

    // ??_onClickApply(279~313??? 媛숇떎. ?깃났 ?뚮┝留??좎뒪?몃줈 諛붾뚭퀬 紐⑸줉?쇰줈 ?뚯븘媛꾨떎.
    const apply = async () => {
        if(!option) return;
        loading = true;
        option.allowedClientNames = option.allowedClientNamesQuery!.split(';').map((name) => name.trim()).filter((name) => name !== '');
        const payload = $state.snapshot(option) as TunnelingOptionEx;
        try {
            const result = await ServerOptionCtrl.instance.updateTunnelingOption(payload, snapshotRevision, {
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
                toast.push({tone: 'alarm', message: 'Fail to apply tunneling option: ' + result.message});
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

    // ??_onClickRemove(245~277??? 媛숇떎. ??젣 踰꾪듉? ??λ맂 ?곕꼸?먮쭔 ?덉쑝誘濡?誘몃룞湲?遺꾧린媛 ?녿떎.
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

    onMount(() => { load(); });
</script>

{#if option}
<form class="tunnel-edit" onsubmit={(e) => e.preventDefault()}>
    <Card>
        <div class="form-stack">
            <Field label="External server port" for="input-external-port">
                <NumberInput id="input-external-port" min={1} max={65535} bind:value={option.forwardPort}
                    oninput={(v) => (option!.forwardPort = clampPort(v) as number)} />
            </Field>
            <Checkbox id="input-tls" label="Secure tunneling Server/Client" bind:checked={option.tls}
                disabled={option.protocol !== 'tcp'} onchange={() => onChangeSecureTunneling(option!.forwardPort)} />
            {#if option.tls === true}
                <InputCertFile certInfo={option.certInfo} hideMessage={true} onupdate={(value) => (option!.certInfo = value)} />
            {/if}
            <Field label="Destination host" for="input-destination-host">
                <TextInput id="input-destination-host" bind:value={option.destinationAddress} />
            </Field>
            <Field label="Destination port" for="input-destination-port">
                <NumberInput id="input-destination-port" min={1} max={65535} bind:value={option.destinationPort}
                    oninput={(v) => (option!.destinationPort = clampPort(v) as number)} />
            </Field>
            <Field label="Allowed client names (Separate names with semicolon(;))" for="input-allow-client-names">
                <TextInput id="input-allow-client-names" bind:value={option.allowedClientNamesQuery} />
            </Field>
            <Field label="Keep-Alive timeout (ms)" for="input-active-timeout">
                <!-- ???곕꼸?먮뒗 keepAlive 媛 ?녿떎. 洹몃?濡?bind ?섎㈃ undefined 瑜?fallback ?덈뒗 prop ???ｌ뼱 Svelte 媛 嫄곕??섎?濡?
                     ?쎄린??null 濡?諛붽씀怨??곌린??鍮?媛믪쓣 ?ㅼ떆 undefined 濡??섎룎????蹂몃Ц怨?媛숈? 紐⑥뼇??吏?⑤떎. -->
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
                <Select id="select-protocol" options={PROTOCOLS} bind:value={option.protocol} onchange={onChangeProtocol} />
            </Field>
            {#if option.protocol === 'http' || option.protocol === 'https'}
                <h2 class="section-title">HTTP options</h2>
                <Field label="Replace host (address) in text body" for="select-change-host-in-body">
                    <Select id="select-change-host-in-body" options={ENABLED}
                        value={String(option.httpOption.rewriteHostInTextBody ?? true)}
                        onchange={(v) => (option!.httpOption.rewriteHostInTextBody = v === 'true')} />
                </Field>
                <Field label="Replace Access-Control-Allow-Origin header" for="select-change-acao">
                    <Select id="select-change-acao" options={ENABLED}
                        value={String(option.httpOption.replaceAccessControlAllowOrigin ?? false)}
                        onchange={(v) => (option!.httpOption.replaceAccessControlAllowOrigin = v === 'true')} />
                </Field>
                <Field label="Inject request header">
                    <HeaderAppender bind:options={option.httpOption.customRequestHeaders} />
                </Field>
                <Field label="Inject response header">
                    <HeaderAppender bind:options={option.httpOption.customResponseHeaders} />
                </Field>
                <Field label="Replace text in body">
                    <BodyReplaceAppender bind:options={option.httpOption.bodyRewriteRules} />
                </Field>
            {/if}
            <Checkbox id="input-inactive-on-startup" label="Inactive on startup" bind:checked={option.inactiveOnStartup} />
        </div>
    </Card>
</form>
<div class="edit-bar">
    <Button variant="primary" disabled={!updatable} onclick={apply}>{option.isSync ? 'Apply and Restart' : 'Start'}</Button>
    {#if option.isSync}
        <Button variant="danger" onclick={() => (confirmOpen = true)}>Stop and Remove</Button>
    {/if}
</div>
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
