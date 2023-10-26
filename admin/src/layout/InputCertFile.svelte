<script lang="ts">
    import forge, {pki} from 'node-forge';
    import CryptoJS from "crypto-js";
    import {type CertInfo, type PemData} from "../controller/Types";
    import {onMount, createEventDispatcher, beforeUpdate, afterUpdate} from "svelte";
    import ObjectUtil from "../controller/ObjectUtil";
    import AlertLayout from "../component/AlertLayout.svelte";
    import _ from "lodash";


    let _inputKeyFileEle: HTMLInputElement;
    let _inputCertFileEle: HTMLInputElement;
    let _inputCaFileEle: HTMLInputElement;
    let _isInit = false;
    let _dispatch = createEventDispatcher();

    let _showAlert = false;
    let _alertMessage = '';
    export let hideMessage: boolean = false;



    export let width: number = 250;


    export let certInfo: CertInfo | undefined | null;

    if(!certInfo) {
        certInfo = {
            key: {
                name: '',
                value: ''
            },
            cert: {
                name: '',
                value:''
            },
            ca: {
                name: '',
                value: ''
            }
        };
    }



    let _tempCertInfo = _.cloneDeep(certInfo);




    let _updateCertInfo = () => {

        if(!ObjectUtil.equalsDeep(certInfo, _tempCertInfo)) {
            _dispatch('update', _.cloneDeep(_tempCertInfo));
        }
        certInfo = _.cloneDeep(_tempCertInfo);

    }

    onMount(async () => {
        if(!_isInit && _inputCertFileEle) {
            _resetInputFile();
            _isInit = true;

        }
    });

    afterUpdate(async () => {
        _tempCertInfo = _.cloneDeep(certInfo!);
        _resetInputFile();
    });



    let _alert = (message: string) => {
        _alertMessage = message;
        _showAlert = true;
    }



    let _resetInputFile = () => {

        _tempCertInfo = _.cloneDeep(certInfo!);
        if(_inputCertFileEle && _tempCertInfo.cert.name != '' && _tempCertInfo.cert.value != '') {
            _inputCertFileEle.files = _pemDataToDataTransfer(_tempCertInfo.cert).files;
        } else if(_inputCertFileEle) {
            _inputCertFileEle.value = '';
        }
        if(_inputKeyFileEle && _tempCertInfo.key.name != '' && _tempCertInfo.key.value != '') {
            _inputKeyFileEle.files = _pemDataToDataTransfer(_tempCertInfo.key).files;
        } else if(_inputKeyFileEle) {
            _inputKeyFileEle.value = '';
        }
        if(_inputCaFileEle && _tempCertInfo.ca.name != '' && _tempCertInfo.ca.value != '') {
            _inputCaFileEle.files = _pemDataToDataTransfer(_tempCertInfo.ca).files;
        } else if(_inputCaFileEle) {
            _inputCaFileEle.value = '';
        }
    }


    let _clearKeyAndCert = () => {
        certInfo!.key.name = '';
        certInfo!.key.value = '';
        certInfo!.cert.name = '';
        certInfo!.cert.value = '';
        certInfo!.ca.name = '';
        certInfo!.ca.value = '';
        _tempCertInfo.key.name = '';
        _tempCertInfo.key.value = '';
        _tempCertInfo.cert.name = '';
        _tempCertInfo.cert.value = '';
        _inputKeyFileEle.value = '';
        _inputCertFileEle.value = '';
    }


    let _pemDataToDataTransfer = (pemData: PemData) : DataTransfer  => {
        let dt = new DataTransfer()
        let file = new File([_textToBLob(pemData.value)], pemData.name);
        dt.items.add(file);
        return dt;
    }

    let _textToBLob = (text: string) : Blob => {
        return new Blob([text], {type: 'text/plain'});
    }

    let enforceMinMax = (e: KeyboardEvent) => {
        let el = e.target as HTMLInputElement;
        if (el.value != "") {
            if (parseInt(el.value) < parseInt(el.min)) {
                el.value = el.min;
            }
            if (parseInt(el.value) > parseInt(el.max)) {
                el.value = el.max;
            }
        }
    }

    let _validKeyPair = (privateKey: string, certificate: string) : boolean => {
        try {
            const certificateObject = forge.pki.certificateFromPem(certificate);
            const privateKeyObject = forge.pki.privateKeyFromPem(privateKey);
            const plain = CryptoJS.SHA512(Date.now() + '@').toString();
            let encrypted = (certificateObject.publicKey as pki.rsa.PublicKey).encrypt(plain, 'RSA-OAEP', {
                md: forge.md.sha256.create(),
                mgf1: {
                    md: forge.md.sha256.create()
                }
            });
            let decrypted = privateKeyObject.decrypt(encrypted, 'RSA-OAEP', {
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
    }

    let _isValidCertificate = (pemPublicKey: string) : boolean => {
        pemPublicKey = pemPublicKey.trim();
        if (!pemPublicKey.startsWith('-----BEGIN CERTIFICATE') || !pemPublicKey.endsWith('END CERTIFICATE-----')) {
            return false;
        }
        try {
            const certificate = forge.pki.certificateFromPem(pemPublicKey);
            if ((certificate.publicKey as pki.rsa.PublicKey).n.bitLength() < 2048) {
                return false;
            }
        } catch (error) {
            console.error(error);
            return false;
        }
        return true;
    }


    let _isValidPrivateKey = (pemPrivateKey: string): boolean => {
        pemPrivateKey = pemPrivateKey.trim();
        if ( (!pemPrivateKey.startsWith('-----BEGIN PRIVATE KEY') || !pemPrivateKey.endsWith('END PRIVATE KEY-----')) &&
            (!pemPrivateKey.startsWith('-----BEGIN RSA PRIVATE KEY') || !pemPrivateKey.endsWith('END RSA PRIVATE KEY-----'))) {
            return false;
        }
        try {
            const privateKeyObject = forge.pki.privateKeyFromPem(pemPrivateKey);
            if (privateKeyObject.n.bitLength() < 2048) {
                return false;
            }
        } catch (error) {
            console.error(error);
            return false;
        }
        return true;
    }

    let _checkTypeAndSet = async (type : 'private'| 'cert' | 'ca',element: HTMLInputElement, data: PemData, keyChecker: (text: string) => boolean) => {
        let file = element.files?.item(0);
        if(!file) return;
        let text = await _readFileToString(file);
        let old = (data.name != '' && data.value != '') ? _pemDataToDataTransfer(data) : null;
        if (!keyChecker(text)) {
            _alert(`Invalid ${type == 'private' ? "private key" : "certificate"}`);
            if(old) _inputKeyFileEle.files = old!.files;
            else element.value = '';
            return;
        }
        data.name = file.name;
        data.value = text;
        let result = _checkKeyPair();
        if(result == 'Success') {
            _updateCertInfo();
        } else if(result == 'Fail') {
            _clearKeyAndCert();
        }

    }


    let _onInputFile = async (e: Event, type : 'private'| 'cert' | 'ca') => {
        let target = e.target as HTMLInputElement;
        let file = target.files?.item(0);
        if (file) {
            let text = await _readFileToString(file);
            if (type == 'private') {
                await _checkTypeAndSet(type, target, _tempCertInfo.key, _isValidPrivateKey)
            } else if(type == 'cert') {
                await _checkTypeAndSet(type, target, _tempCertInfo.cert, _isValidCertificate)
            }
            else if(type == 'ca') {
                await _checkTypeAndSet(type, target, _tempCertInfo.ca, _isValidCertificate)
            }

        }
    }

    let _checkKeyPair = () : 'Success' | 'Fail' | 'NoCondition'  => {
        if(_tempCertInfo.cert.value == '' || _tempCertInfo.key.value == '') {
            return 'NoCondition';
        }
        if (_validKeyPair(_tempCertInfo.key.value, _tempCertInfo.cert.value)) {
            return 'Success';
        } else {
            _alert('Invalid Key Pair');
            return 'Fail';
        }
    }

    let _readFileToString = (file: File) : Promise<string> => {
        let reader = new FileReader();
        reader.readAsText(file);
        let result = '';
        return new Promise((resolve, reject) => {
            reader.onload = (e) => {
                result = e.target?.result as string;
                resolve(result);
            }
        });
    }

    let _onClickRemoveCa = () => {
        _tempCertInfo.ca.name = '';
        _tempCertInfo.ca.value = '';
        if(_checkKeyPair() == 'Success') {
            _updateCertInfo();
        }
        _inputCaFileEle.value = '';
        certInfo!.ca.name = '';
        certInfo!.ca.value = '';
    }


</script>
<main>
    <div class="cert-select-box">
        <div class="cert-select-box-vertical-line"></div>
        <div class="input-box file-input-box">
            <div class="form-label  file-label" style="display: inline-block">Key<span style="font-weight: bold;color: saddlebrown; font-size: 9pt">*</span></div>
            <input type="file" class="form-control"  on:keyup={enforceMinMax}  accept=".pem, *.crt, *.cer"  style="width: {width}px;"  on:input={e => _onInputFile(e, 'private')} bind:this={_inputKeyFileEle} >
        </div>

        <div class="input-box file-input-box">
            <div class="form-label  file-label" style="display: inline">Cert<span style="font-weight: bold;color: saddlebrown; font-size: 9pt">*</span></div>
            <input type="file" class="form-control" on:keyup={enforceMinMax}  accept=".pem, *.crt, *.cer"   style="width: {width}px;" on:input={e => _onInputFile(e, 'cert')}  bind:this={_inputCertFileEle}>
        </div>

        <div class="input-box file-input-box">
            <div class="form-label file-label" style="display: inline-block">CA</div>
            <input type="file" class="form-control" on:keyup={enforceMinMax} accept=".pem, *.crt, *.cer"  style="width: {width}px;" on:input={e => _onInputFile(e, 'ca')}  bind:this={_inputCaFileEle} >
            <div style="display: inline;position: relative;"> <button  class="text-button-x" on:click={_onClickRemoveCa} aria-pressed="true" >X</button></div>
        </div>
        {#if hideMessage === false}
        <ul>
            <li>If you do not upload a cert, a random key will be used.</li>
            <li>If an incorrect cert is uploaded, it will work with HTTP.</li>
        </ul>
        {/if}
    </div>

    <AlertLayout bind:show={_showAlert}>
        {_alertMessage}
    </AlertLayout>
</main>
<style>


    .cert-select-box-vertical-line {
        width: 2px;
        height: 90px;
        background: #41464b;
        position: absolute;
        top: 0;

    }


    ul {
        margin-top: 0;
        margin-bottom: 0;
    }

    li {
        margin-left: -10px;
        font-size: 10pt;
        color: #666;

    }

    .file-label {
        width: 32px;
        text-align: right;
    }

    .file-input-box {
        margin-left: 10px;
        margin-bottom: 5px;
    }

    .cert-select-box {
        position: relative;
        padding-left: 2px;
        margin-bottom: 20px;
    }

    .text-button-x {
        background: none;
        border: none;
        text-align: left;
        font-size: 10pt;
        width: 48px;
        height: 28px;
        position: absolute;
        padding: 7px 0 0 5px;

        color: #7f7f7f;
        font-weight: bold;
        cursor: pointer;
    }

    .text-button-x:hover {
        color: red;
        background: none;
        border: none;
    }
</style>