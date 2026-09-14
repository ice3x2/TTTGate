<script lang="ts">
    import forge, {pki} from 'node-forge';
    import _ from 'lodash';
    import {onMount, untrack} from 'svelte';
    import {randomHex} from '../../util/hash';
    import ObjectUtil from '../../controller/ObjectUtil';
    import type {CertInfo, PemData} from '../../controller/Types';
    import Button from '../../ui/Button.svelte';
    import Field from '../../ui/Field.svelte';
    import Modal from '../../ui/Modal.svelte';

    let {
        certInfo,
        hideMessage = false,
        class: className = '',
        onupdate,
    }: {
        certInfo: CertInfo | null | undefined;
        hideMessage?: boolean;
        class?: string;
        onupdate?: (value: CertInfo) => void;
    } = $props();

    const uid = $props.id();

    const emptyCertInfo = (): CertInfo => ({
        key: {name: '', value: ''},
        cert: {name: '', value: ''},
        ca: {name: '', value: ''},
    });

    // 부모가 마지막으로 준 값의 사본. 편집 중 값과 비교하는 기준이며 렌더에는 쓰이지 않는다.
    // 초기 사본은 아래 $effect 의 첫 실행이 만든다.
    let lastCertInfo: CertInfo | undefined;
    let tempCertInfo = $state<CertInfo>(emptyCertInfo());

    let keyEl: HTMLInputElement | undefined = $state();
    let certEl: HTMLInputElement | undefined = $state();
    let caEl: HTMLInputElement | undefined = $state();

    let alertOpen = $state(false);
    let alertMessage = $state('');

    const alert = (message: string) => {
        alertMessage = message;
        alertOpen = true;
    };

    // prop 을 대입·변이하지 않는다. 부모 값이 바뀐 경우에만 편집 중 값을 그 값으로 되돌린다.
    const sync = (value: CertInfo) => {
        if(lastCertInfo && ObjectUtil.equalsDeep(value, lastCertInfo)) return;
        lastCertInfo = _.cloneDeep(value);
        tempCertInfo = _.cloneDeep(value);
        resetInputFile();
    };

    $effect(() => {
        // snapshot 이 깊은 필드까지 읽으므로 부모의 제자리 변이도 추적된다.
        const value = certInfo ? $state.snapshot(certInfo) as CertInfo : emptyCertInfo();
        untrack(() => sync(value));
    });

    const updateCertInfo = () => {
        if(!ObjectUtil.equalsDeep(lastCertInfo, tempCertInfo)) {
            onupdate?.(_.cloneDeep($state.snapshot(tempCertInfo)));
        }
        lastCertInfo = _.cloneDeep($state.snapshot(tempCertInfo));
    };

    onMount(() => {
        resetInputFile();
    });

    const resetInputFile = () => {
        if(certEl && tempCertInfo.cert.name != '' && tempCertInfo.cert.value != '') {
            certEl.files = pemDataToDataTransfer(tempCertInfo.cert).files;
        } else if(certEl) {
            certEl.value = '';
        }
        if(keyEl && tempCertInfo.key.name != '' && tempCertInfo.key.value != '') {
            keyEl.files = pemDataToDataTransfer(tempCertInfo.key).files;
        } else if(keyEl) {
            keyEl.value = '';
        }
        if(caEl && tempCertInfo.ca.name != '' && tempCertInfo.ca.value != '') {
            caEl.files = pemDataToDataTransfer(tempCertInfo.ca).files;
        } else if(caEl) {
            caEl.value = '';
        }
    };

    const clearKeyAndCert = () => {
        tempCertInfo.key.name = '';
        tempCertInfo.key.value = '';
        tempCertInfo.cert.name = '';
        tempCertInfo.cert.value = '';
        keyEl!.value = '';
        certEl!.value = '';
    };

    const pemDataToDataTransfer = (pemData: PemData): DataTransfer => {
        const dt = new DataTransfer();
        const file = new File([textToBlob(pemData.value)], pemData.name);
        dt.items.add(file);
        return dt;
    };

    const textToBlob = (text: string): Blob => new Blob([text], {type: 'text/plain'});

    const validKeyPair = (privateKey: string, certificate: string): boolean => {
        try {
            const certificateObject = forge.pki.certificateFromPem(certificate);
            const privateKeyObject = forge.pki.privateKeyFromPem(privateKey);
            const plain = randomHex(64);
            const encrypted = (certificateObject.publicKey as pki.rsa.PublicKey).encrypt(plain, 'RSA-OAEP', {
                md: forge.md.sha256.create(),
                mgf1: {
                    md: forge.md.sha256.create()
                }
            });
            const decrypted = privateKeyObject.decrypt(encrypted, 'RSA-OAEP', {
                md: forge.md.sha256.create(),
                mgf1: {
                    md: forge.md.sha256.create()
                }
            });
            return decrypted == plain;
        } catch (error) {
            console.error(error);
            return false;
        }
    };

    const isValidCertificate = (pemPublicKey: string): boolean => {
        pemPublicKey = pemPublicKey.trim();
        if(!pemPublicKey.startsWith('-----BEGIN CERTIFICATE') || !pemPublicKey.endsWith('END CERTIFICATE-----')) {
            return false;
        }
        try {
            const certificate = forge.pki.certificateFromPem(pemPublicKey);
            if((certificate.publicKey as pki.rsa.PublicKey).n.bitLength() < 2048) {
                return false;
            }
        } catch (error) {
            console.error(error);
            return false;
        }
        return true;
    };

    const isValidPrivateKey = (pemPrivateKey: string): boolean => {
        pemPrivateKey = pemPrivateKey.trim();
        if((!pemPrivateKey.startsWith('-----BEGIN PRIVATE KEY') || !pemPrivateKey.endsWith('END PRIVATE KEY-----')) &&
            (!pemPrivateKey.startsWith('-----BEGIN RSA PRIVATE KEY') || !pemPrivateKey.endsWith('END RSA PRIVATE KEY-----'))) {
            return false;
        }
        try {
            const privateKeyObject = forge.pki.privateKeyFromPem(pemPrivateKey);
            if(privateKeyObject.n.bitLength() < 2048) {
                return false;
            }
        } catch (error) {
            console.error(error);
            return false;
        }
        return true;
    };

    const checkTypeAndSet = async (type: 'private' | 'cert' | 'ca', element: HTMLInputElement, data: PemData, keyChecker: (text: string) => boolean) => {
        const file = element.files?.item(0);
        if(!file) return;
        const text = await readFileToString(file);
        const old = (data.name != '' && data.value != '') ? pemDataToDataTransfer(data) : null;
        if(!keyChecker(text)) {
            alert(`Invalid ${type == 'private' ? 'private key' : 'certificate'}`);
            if(old) keyEl!.files = old.files;
            else element.value = '';
            return;
        }
        data.name = file.name;
        data.value = text;
        const result = checkKeyPair();
        if(result == 'Success') {
            updateCertInfo();
        } else if(result == 'Fail') {
            clearKeyAndCert();
        }
    };

    const onInputFile = async (e: Event, type: 'private' | 'cert' | 'ca') => {
        const target = e.target as HTMLInputElement;
        const file = target.files?.item(0);
        if(file) {
            if(type == 'private') {
                await checkTypeAndSet(type, target, tempCertInfo.key, isValidPrivateKey);
            } else if(type == 'cert') {
                await checkTypeAndSet(type, target, tempCertInfo.cert, isValidCertificate);
            } else if(type == 'ca') {
                await checkTypeAndSet(type, target, tempCertInfo.ca, isValidCertificate);
            }
        }
    };

    const checkKeyPair = (): 'Success' | 'Fail' | 'NoCondition' => {
        if(tempCertInfo.cert.value == '' || tempCertInfo.key.value == '') {
            return 'NoCondition';
        }
        if(validKeyPair(tempCertInfo.key.value, tempCertInfo.cert.value)) {
            return 'Success';
        }
        alert('Invalid Key Pair');
        return 'Fail';
    };

    const readFileToString = (file: File): Promise<string> => {
        const reader = new FileReader();
        reader.readAsText(file);
        return new Promise((resolve) => {
            reader.onload = (e) => {
                resolve(e.target?.result as string);
            };
        });
    };

    const removeCa = () => {
        tempCertInfo.ca.name = '';
        tempCertInfo.ca.value = '';
        if(checkKeyPair() == 'Success') {
            updateCertInfo();
        }
        caEl!.value = '';
    };
</script>

<div class="cert-files {className}">
    <Field label="Key" for={`${uid}-key`}>
        <input class="input" type="file" id={`${uid}-key`} accept=".pem,.crt,.cer"
            oninput={(e) => onInputFile(e, 'private')} bind:this={keyEl}>
    </Field>
    <Field label="Cert" for={`${uid}-cert`}>
        <input class="input" type="file" id={`${uid}-cert`} accept=".pem,.crt,.cer"
            oninput={(e) => onInputFile(e, 'cert')} bind:this={certEl}>
    </Field>
    <Field label="CA" for={`${uid}-ca`}>
        <div class="cert-ca-row">
            <input class="input" type="file" id={`${uid}-ca`} accept=".pem,.crt,.cer"
                oninput={(e) => onInputFile(e, 'ca')} bind:this={caEl}>
            <Button size="sm" onclick={removeCa}>Remove CA</Button>
        </div>
    </Field>
    {#if !hideMessage}
        <ul class="cert-notes">
            <li>If you do not upload a cert, a random key will be used.</li>
            <li>If an incorrect cert is uploaded, it will work with HTTP.</li>
        </ul>
    {/if}
    <Modal bind:open={alertOpen} title="Certificate">
        {alertMessage}
        {#snippet footer()}
            <Button variant="primary" onclick={() => (alertOpen = false)}>OK</Button>
        {/snippet}
    </Modal>
</div>

<style>
    .cert-files { display: flex; flex-direction: column; gap: var(--s-3); padding-left: var(--s-3); border-left: 2px solid var(--line-2); }
    .cert-ca-row { display: flex; gap: var(--s-2); align-items: center; }
    .cert-notes { margin: 0; padding-left: var(--s-4); font-size: var(--fs-xs); color: var(--ink-2); }

    /* 전역 file-selector-button 스타일은 #83 에서 지워졌으므로 파일 입력의 모양을 여기서 정한다.
       바탕은 ui/TextInput 의 .input 과 같은 토큰을 쓴다. */
    .input {
        min-width: 0;
        width: 100%;
        font-family: var(--ff-mono);
        font-size: 13px;
        color: var(--ink-1);
        background: var(--bg-mute);
        border: 1px solid var(--line-1);
        border-radius: var(--r-1);
        padding: 6px;
        outline: none;
        transition: border-color var(--dur-2) var(--ease-out),
                    box-shadow var(--dur-2) var(--ease-out);
    }
    .input:hover { border-color: var(--line-2); }
    .input:focus-visible {
        border-color: var(--signal);
        box-shadow: 0 0 0 3px var(--signal-glow);
    }
    .input::file-selector-button {
        margin-right: var(--s-3);
        font-family: var(--ff-ui);
        font-size: 12px;
        font-weight: 500;
        color: var(--ink-0);
        background: transparent;
        border: 1px solid var(--line-2);
        border-radius: var(--r-2);
        padding: 5px 10px;
        cursor: pointer;
    }
    .input::file-selector-button:hover { border-color: var(--ink-2); }
</style>
