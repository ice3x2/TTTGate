import Files, {AtomicFileValue} from "../util/Files";
import File from "../util/File";
import Environment from "../Environment";
import CACertGenerator from "../commons/CACertGenerator";
import forge, {pki} from "node-forge";
import {createHash} from "node:crypto";
import ObjectUtil from "../util/ObjectUtil";
import LoggerFactory  from "../util/logger/LoggerFactory";
import fs from "fs";
import {createInitialRevisionState, RevisionState} from "./RevisionState";
const logger = LoggerFactory.getLogger('server', 'CertificationStore');

interface PemData {
    name: string;
    value: string;
}

type CertInfo = {
    cert : PemData;
    key : PemData;
    ca: PemData;
}

type ExternalCertFileInfo = {
    [port: number]: CertInfo;
}


const ADMIN_CERT_FILE_INFO_FILE_NAME: string = '.adminCert.json';
const EXTERNAL_CERT_FILE_INFO_FILE_NAME: string = '.externalCert.json';
const CERT_STATE_FILE_NAME: string = '.cert.state.json';

class CertificationStore {

    private static _instance: CertificationStore;
    private _externalCert: ExternalCertFileInfo = {};
    private _adminCert: CertInfo = CertificationStore.makeEmptyCertFileInfo();
    private _tempCert: CertInfo | undefined = undefined;
    private _revisionState: RevisionState;

    private _adminCertFile: File = new File(Environment.path.certDir, ADMIN_CERT_FILE_INFO_FILE_NAME);
    private _externalCertFile: File = new File(Environment.path.certDir, EXTERNAL_CERT_FILE_INFO_FILE_NAME);
    private _stateFile: File = new File(Environment.path.certDir, CERT_STATE_FILE_NAME);


    private static makeEmptyCertFileInfo() : CertInfo {
        return {
            cert: {
                name: '',
                value: ''
            },
            key: {
                name: '',
                value: ''
            },
            ca: {
                name: '',
                value: ''
            }
        }
    }



    private constructor() {
        this._revisionState = this.loadRevisionState();
    }

    public static get instance(): CertificationStore {
        if (!CertificationStore._instance) {
            CertificationStore._instance = new CertificationStore();
        }
        return CertificationStore._instance;
    }

    public static resetForTest(): void {
        CertificationStore._instance = undefined as any;
    }

    public async makeTempCert() {
        let cert = await CACertGenerator.genCACert();
        return {
            cert: {
                name: 'temp.cert.pem',
                value: cert.cert
            },
            key: {
                name: 'temp.key.pem',
                value: cert.key
            },
            ca: {
                name: '',
                value: ''
            }
        };
    }

    public getTempCert() : CertInfo {
        return ObjectUtil.cloneDeep(this._tempCert!);
    }

    public get revisionState(): RevisionState {
        return ObjectUtil.cloneDeep(this._revisionState);
    }

    public async reset() {
        this._externalCert = {};
        this._adminCert = CertificationStore.makeEmptyCertFileInfo();
        this._tempCert =  await this.makeTempCert();
        this._revisionState = createInitialRevisionState();

        if(this._adminCertFile.exists()) {
            this._adminCertFile.delete();
        }

        if(this._externalCertFile.exists()) {
            this._externalCertFile.delete();
        }
        if(this._stateFile.exists()) {
            this._stateFile.delete();
        }
        let certDir = new File(Environment.path.certDir);
        if(certDir.exists()) {
            Files.deleteAll(certDir);
            certDir.mkdirs();
        }

    }

    public async load() {
        this._tempCert = await this.makeTempCert();
        this._revisionState = this.loadRevisionState();
        await this.loadAdminCert();
        await this.loadExternalCert();
    }

    public getAdminCert() : CertInfo {
        return ObjectUtil.cloneDeep(this._adminCert);
    }




    public getExternalCert(port: number) : CertInfo {
        let cert = this._externalCert[port];
        if(cert) {
            return ObjectUtil.cloneDeep(cert);
        }
        let tempCert = ObjectUtil.cloneDeep(this._tempCert!)
        tempCert.cert.name = `external.${port}.cert.pem`;
        tempCert.key.name = `external.${port}.key.pem`;
        return tempCert;


    }

    public getAllExternalCert() : ExternalCertFileInfo {
        return ObjectUtil.cloneDeep(this._externalCert);
    }


    public prepareAdminServerCert(certInfo: CertInfo): boolean {
        return this.checkKeyPair(certInfo);
    }

    public prepareExternalServerCert(certInfo: CertInfo): boolean {
        return this.checkKeyPair(certInfo);
    }

    private certificateFiles(info: CertInfo, type: 'admin' | 'external'): AtomicFileValue[] {
        const directory = type === 'admin' ? Environment.path.adminCertDir : Environment.path.externalCertDir;
        return [info.key, info.cert, info.ca].filter(part => part.name !== '' && part.value !== '')
            .map(part => ({file: new File(directory, part.name), data: part.value, mode: 0o600}));
    }

    public captureCommittedState(candidate?: {info: CertInfo, type: 'admin' | 'external'}) {
        const files = [this._adminCertFile, this._externalCertFile, this._stateFile,
            ...this.certificateFiles(this._adminCert, 'admin').map(entry => entry.file),
            ...Object.values(this._externalCert).flatMap(info => this.certificateFiles(info, 'external').map(entry => entry.file)),
            ...(candidate ? this.certificateFiles(candidate.info, candidate.type).map(entry => entry.file) : [])];
        return {adminCert: this.getAdminCert(), externalCert: this.getAllExternalCert(), revisionState: this.revisionState,
            files: Files.captureFiles([...new Map(files.map(file => [file.toString(), file])).values()])};
    }

    public restoreCommittedState(state: ReturnType<CertificationStore['captureCommittedState']>): void {
        Files.writeAtomicBatchSync(state.files);
        this._adminCert = ObjectUtil.cloneDeep(state.adminCert);
        this._externalCert = ObjectUtil.cloneDeep(state.externalCert);
        this._revisionState = ObjectUtil.cloneDeep(state.revisionState);
    }

    private persistCertificateChange(type: 'admin' | 'external', adminCert: CertInfo, externalCert: ExternalCertFileInfo,
        previous: CertInfo | undefined, next: CertInfo | undefined,
        options: {markLastKnownGood?: boolean, pendingRestartScopes?: string[]}): void {
        const revisionState = this.revisionState;
        revisionState.currentRevision++;
        revisionState.lastCommittedAt = Date.now();
        const remaining = revisionState.pendingRestartScopes.filter(scope => !(type === 'admin' && options.markLastKnownGood !== false && scope === 'admin-cert'));
        revisionState.pendingRestartScopes = [...new Set([...remaining, ...(options.pendingRestartScopes ?? [])])];
        if(options.markLastKnownGood !== false && revisionState.pendingRestartScopes.length === 0) {
            revisionState.lastKnownGoodRevision = revisionState.currentRevision;
            revisionState.lastKnownGoodAt = revisionState.lastCommittedAt;
        }
        revisionState.lastRollback = undefined;
        const retained = type === 'admin' ? this.certificateFiles(adminCert, type)
            : Object.values(externalCert).flatMap(info => this.certificateFiles(info, type));
        const retainedPaths = new Set(retained.map(entry => entry.file.toString()));
        const removed = previous ? this.certificateFiles(previous, type).filter(entry => !retainedPaths.has(entry.file.toString()))
            .map(entry => ({file: entry.file})) : [];
        const directory = new File(type === 'admin' ? Environment.path.adminCertDir : Environment.path.externalCertDir);
        if(!directory.exists()) directory.mkdirs();
        this.secureDirectory(directory);
        try {
            Files.writeAtomicBatchSync([
                {file: type === 'admin' ? this._adminCertFile : this._externalCertFile,
                    data: JSON.stringify(type === 'admin' ? adminCert : externalCert, null, 4), mode: 0o600},
                ...(next ? this.certificateFiles(next, type) : []),
                ...removed,
                {file: this._stateFile, data: JSON.stringify(revisionState, null, 2), mode: 0o600},
            ]);
        } catch(error) {
            Object.assign(error as object, {persistenceScope: 'certificate'});
            throw error;
        }
        this._adminCert = ObjectUtil.cloneDeep(adminCert);
        this._externalCert = ObjectUtil.cloneDeep(externalCert);
        this._revisionState = revisionState;
    }

    public async commitAdminServerCert(certInfo: CertInfo,
        options: {markLastKnownGood?: boolean, pendingRestartScopes?: string[]} = {}): Promise<boolean> {
        if(!this.prepareAdminServerCert(certInfo)) return false;
        this.persistCertificateChange('admin', certInfo, this._externalCert, this._adminCert, certInfo, options);
        return true;
    }

    public async commitExternalServerCert(port: number, certInfo: CertInfo,
        options: {markLastKnownGood?: boolean, pendingRestartScopes?: string[]} = {}): Promise<boolean> {
        if(!this.prepareExternalServerCert(certInfo)) return false;
        this.persistCertificateChange('external', this._adminCert, {...this._externalCert, [port]: certInfo},
            this._externalCert[port], certInfo, options);
        return true;
    }

    public markLastKnownGood(revision: number = this._revisionState.currentRevision, pendingRestartScopes: string[] = []): void {
        this._revisionState.lastKnownGoodRevision = revision;
        this._revisionState.lastKnownGoodAt = Date.now();
        this._revisionState.pendingRestartScopes = [...pendingRestartScopes];
        if(pendingRestartScopes.length == 0 && revision == this._revisionState.currentRevision) {
            this._revisionState.lastRollback = undefined;
        }
        this.saveRevisionState();
    }

    public recordRollback(reason: string, failedScopes: string[], attemptedRevision?: number, restoredRevision = this._revisionState.currentRevision): void {
        const revisionState = this.revisionState;
        revisionState.lastRollback = {at: Date.now(), reason, failedScopes: [...failedScopes],
            attemptedRevision: attemptedRevision ?? (revisionState.currentRevision + 1), restoredRevision};
        Files.writeAtomicBatchSync([{file: this._stateFile, data: JSON.stringify(revisionState, null, 2), mode: 0o600}]);
        this._revisionState = revisionState;
    }

    public async updateAdminServerCert(certInfo: CertInfo) : Promise<boolean>  {
        return await this.commitAdminServerCert(certInfo);
    }

    public async updateExternalServerCert(port: number, certInfo: CertInfo) : Promise<boolean> {
        return await this.commitExternalServerCert(port, certInfo);
    }

    public async removeForExternalServer(port: number) {
        const external = this.getAllExternalCert();
        delete external[port];
        this.persistCertificateChange('external', this._adminCert, external, this._externalCert[port], undefined, {});
    }

    public async removeForAdminServer() {
        this.persistCertificateChange('admin', CertificationStore.makeEmptyCertFileInfo(), this._externalCert, this._adminCert, undefined, {});
    }

    public async saveForExternalServer(port: number, certInfo: CertInfo) : Promise<boolean> {
        return await this.commitExternalServerCert(port, certInfo);
    }



    public async loadExternalCert() {
        let file = new File(Environment.path.certDir,EXTERNAL_CERT_FILE_INFO_FILE_NAME);
        if(file.exists()) {
            let data : string | undefined  = await Files.toString(file);
            if(data) {
                this._externalCert = JSON.parse(data);
            } else {
                this._externalCert = {};
            }
        }
    }


    public async loadAdminCert() {
        let file = new File(Environment.path.certDir,ADMIN_CERT_FILE_INFO_FILE_NAME);
        if(file.exists()) {
            let data : string | undefined  = await Files.toString(file);
            if(data) {
                this._adminCert = JSON.parse(data);
            }
        } else {
            let cert = await CACertGenerator.genCACert();
            let adminCert = {
                cert: {
                    name: 'admin.cert.pem',
                    value: cert.cert
                },
                key: {
                    name: 'admin.key.pem',
                    value: cert.key
                },
                ca: {
                    name: '',
                    value: ''
                }
            };
            await this.updateAdminServerCert(adminCert);
        }
    }

    private loadRevisionState(): RevisionState {
        try {
            const raw = Files.toStringSync(this._stateFile);
            if(!raw || raw.length == 0) {
                return createInitialRevisionState();
            }
            const loaded = JSON.parse(raw) as RevisionState;
            return {
                ...createInitialRevisionState(),
                ...loaded,
                pendingRestartScopes: [...(loaded.pendingRestartScopes ?? [])]
            };
        } catch {
            return createInitialRevisionState();
        }
    }

    private saveRevisionState(): void {
        Files.writeAtomicSync(this._stateFile, JSON.stringify(this._revisionState, null, 2));
        this.secureFile(this._stateFile);
    }


    private checkKeyPair(cert: CertInfo) : boolean {
        return CertificationStore.isValidCertificate(cert.cert.value) &&
              CertificationStore.isValidPrivateKey(cert.key.value) &&
            (cert.ca.value == '' || CertificationStore.isValidCertificate(cert.ca.value))
            && this.validateKeyPair(cert.key.value, cert.cert.value);

    }


    private validateKeyPair(privateKey: string, certificate: string) : boolean  {
        try {
            const certificateObject = forge.pki.certificateFromPem(certificate);
            const privateKeyObject = forge.pki.privateKeyFromPem(privateKey);
            const plain = createHash('sha512').update(Date.now() + '@').digest('hex');
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
            logger.error('Key pair does not match.',error);
            return false;
        }
    }


    private static isValidPrivateKey(pemPrivateKey: string): boolean {
        pemPrivateKey = pemPrivateKey.trim();
        if ( (!pemPrivateKey.startsWith('-----BEGIN PRIVATE KEY') || !pemPrivateKey.endsWith('END PRIVATE KEY-----')) &&
            (!pemPrivateKey.startsWith('-----BEGIN RSA PRIVATE KEY') || !pemPrivateKey.endsWith('END RSA PRIVATE KEY-----'))) {
            logger.error('Private key format is incorrect.');
            return false;
        }
        try {
            const privateKeyObject = forge.pki.privateKeyFromPem(pemPrivateKey);
            if (privateKeyObject.n.bitLength() < 2048) {
                logger.error('Private key length is short.');
                return false;
            }
        } catch (error) {
            logger.error('Private key format is incorrect.',error);
            return false;
        }
        return true;
    }


    private static isValidCertificate(pemPublicKey: string) : boolean {
        pemPublicKey = pemPublicKey.trim();
        if (!pemPublicKey.startsWith('-----BEGIN CERTIFICATE') || !pemPublicKey.endsWith('END CERTIFICATE-----')) {
            logger.error('Certificate(pem) format is incorrect.');
            return false;
        }
        try {
            const certificate = forge.pki.certificateFromPem(pemPublicKey);
            if (certificate.publicKey && (certificate.publicKey as pki.rsa.PublicKey).n.bitLength() < 2048) {
                logger.error('Public key length is short.');
                return false;
            }
        } catch (error) {
            logger.error('Certificate(pem) format is incorrect.',error);
            return false;
        }
        return true;
    }

    private secureFile(file: File): void {
        try {
            fs.chmodSync(file.toString(), 0o600);
        } catch {}
    }

    private secureDirectory(dir: File): void {
        try {
            fs.chmodSync(dir.toString(), 0o700);
        } catch {}
    }










}

export {CertificationStore, CertInfo, PemData};
