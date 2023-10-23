import Files from "../util/Files";
import File from "../util/File";
import Environment from "../Environment";
import CACertGenerator from "../commons/CACertGenerator";
import forge, {pki} from "node-forge";
import CryptoJS from "crypto-js";
import ObjectUtil from "../util/ObjectUtil";
import LoggerFactory  from "../util/logger/LoggerFactory";
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

class CertificationStore {

    private static _instance: CertificationStore;
    private _externalCert: ExternalCertFileInfo = {};
    private _adminCert: CertInfo = CertificationStore.makeEmptyCertFileInfo();
    private _tempCert: CertInfo | undefined = undefined;

    private _adminCertFile: File = new File(Environment.path.certDir, ADMIN_CERT_FILE_INFO_FILE_NAME);
    private _externalCertFile: File = new File(Environment.path.certDir, EXTERNAL_CERT_FILE_INFO_FILE_NAME);


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

    }

    public static get instance(): CertificationStore {
        if (!CertificationStore._instance) {
            CertificationStore._instance = new CertificationStore();
        }
        return CertificationStore._instance;
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

    public async reset() {
        this._externalCert = {};
        this._adminCert = CertificationStore.makeEmptyCertFileInfo();
        this._tempCert =  await this.makeTempCert();

        if(this._adminCertFile.exists()) {
            this._adminCertFile.delete();
        }

        if(this._externalCertFile.exists()) {
            this._externalCertFile.delete();
        }
        let certDir = new File(Environment.path.certDir);
        if(certDir.exists()) {
            Files.deleteAll(certDir);
            certDir.mkdirs();
        }

    }

    public async load() {
        this._tempCert = await this.makeTempCert();
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


    private async save(file : File, data : any) {
        let strData =  typeof data == 'string' ? data : JSON.stringify(data, null, 4);
        let parent = file.getParentFile();
        if(!parent.exists()) {
            parent.mkdirs();
        }
        if(file.isFile()) {
            file.delete();
            file.createNewFile();
        }
        await Files.write(file, strData);
    }

    private async writeCertFile(info : CertInfo, type: 'admin' | 'external') {
        const dir = type == 'admin' ? Environment.path.adminCertDir : Environment.path.externalCertDir;
        if(!new File(dir).exists()) {
            new File(dir).mkdirs();
        }
        if(info.key.name != '' && info.key.value != '') {
            await this.save(new File(dir, info.key.name), info.key.value);
        }
        if(info.cert.name != '' && info.cert.value != '') {
            await this.save(new File(dir, info.cert.name), info.cert.value);
        }
        if(info.ca.name != '' && info.ca.value != '') {
            await this.save(new File(dir, info.ca.name), info.ca.value);
        }
    }

    private removeCertFile(info : CertInfo, type: 'admin' | 'external') {
        const dir = type == 'admin' ? Environment.path.adminCertDir : Environment.path.externalCertDir;
        if(info.key.name != '') {
            new File(dir, info.key.name).delete();
        }
        if(info.cert.name != '') {
            new File(dir, info.cert.name).delete();
        }
        if(info.ca.name != '') {
            new File(dir, info.ca.name).delete();
        }
    }


    public async updateAdminServerCert(certInfo: CertInfo) : Promise<boolean>  {
        if(!this.checkKeyPair(certInfo)) {
            return false;
        }
        this.removeCertFile(this._adminCert, 'admin');
        this._adminCert = certInfo;
        await this.save(this._adminCertFile, this._adminCert);
        await this.writeCertFile(this._adminCert, 'admin');
        return true;
    }

    public async updateExternalServerCert(port: number, certInfo: CertInfo) : Promise<boolean> {
        if(!this.checkKeyPair(certInfo)) {
            return false;
        }
        let oldInfo : CertInfo | undefined = this._externalCert[port];
        if(oldInfo) {
            this.removeCertFile(oldInfo, 'external');
        }
        this._externalCert[port] = certInfo;
        await this.save(this._externalCertFile, this._externalCert);
        await this.writeCertFile(this._externalCert[port], 'external');
        return true;


    }

    public async removeForExternalServer(port: number) {
        let oldInfo : CertInfo | undefined = this._externalCert[port];
        if(oldInfo) {
            this.removeCertFile(oldInfo, 'external');
        }
        delete this._externalCert[port];
        await this.save(this._externalCertFile, this._externalCert);
    }

    public async removeForAdminServer() {
        this.removeCertFile(this._adminCert, 'admin');
        this._adminCert = CertificationStore.makeEmptyCertFileInfo();
        await this.save(this._adminCertFile, this._adminCert);
    }


    public async saveForExternalServer(port: number, certInfo: CertInfo) : Promise<boolean> {
        if(!this.checkKeyPair(certInfo)) {
            return false;
        }
        let oldInfo : CertInfo | undefined = this._externalCert[port];
        if(oldInfo) {
            this.removeCertFile(oldInfo, 'external');
        }
        this._externalCert[port] = certInfo;
        await this.save(this._externalCertFile, this._externalCert);
        await this.writeCertFile(this._externalCert[port], 'external');
        return true;
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










}

export {CertificationStore, CertInfo, PemData};