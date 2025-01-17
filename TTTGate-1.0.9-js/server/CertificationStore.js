"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CertificationStore = void 0;
const Files_1 = __importDefault(require("../util/Files"));
const File_1 = __importDefault(require("../util/File"));
const Environment_1 = __importDefault(require("../Environment"));
const CACertGenerator_1 = __importDefault(require("../commons/CACertGenerator"));
const node_forge_1 = __importDefault(require("node-forge"));
const crypto_js_1 = __importDefault(require("crypto-js"));
const ObjectUtil_1 = __importDefault(require("../util/ObjectUtil"));
const LoggerFactory_1 = __importDefault(require("../util/logger/LoggerFactory"));
const logger = LoggerFactory_1.default.getLogger('server', 'CertificationStore');
const ADMIN_CERT_FILE_INFO_FILE_NAME = '.adminCert.json';
const EXTERNAL_CERT_FILE_INFO_FILE_NAME = '.externalCert.json';
class CertificationStore {
    static _instance;
    _externalCert = {};
    _adminCert = CertificationStore.makeEmptyCertFileInfo();
    _tempCert = undefined;
    _adminCertFile = new File_1.default(Environment_1.default.path.certDir, ADMIN_CERT_FILE_INFO_FILE_NAME);
    _externalCertFile = new File_1.default(Environment_1.default.path.certDir, EXTERNAL_CERT_FILE_INFO_FILE_NAME);
    static makeEmptyCertFileInfo() {
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
        };
    }
    constructor() {
    }
    static get instance() {
        if (!CertificationStore._instance) {
            CertificationStore._instance = new CertificationStore();
        }
        return CertificationStore._instance;
    }
    async makeTempCert() {
        let cert = await CACertGenerator_1.default.genCACert();
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
    getTempCert() {
        return ObjectUtil_1.default.cloneDeep(this._tempCert);
    }
    async reset() {
        this._externalCert = {};
        this._adminCert = CertificationStore.makeEmptyCertFileInfo();
        this._tempCert = await this.makeTempCert();
        if (this._adminCertFile.exists()) {
            this._adminCertFile.delete();
        }
        if (this._externalCertFile.exists()) {
            this._externalCertFile.delete();
        }
        let certDir = new File_1.default(Environment_1.default.path.certDir);
        if (certDir.exists()) {
            Files_1.default.deleteAll(certDir);
            certDir.mkdirs();
        }
    }
    async load() {
        this._tempCert = await this.makeTempCert();
        await this.loadAdminCert();
        await this.loadExternalCert();
    }
    getAdminCert() {
        return ObjectUtil_1.default.cloneDeep(this._adminCert);
    }
    getExternalCert(port) {
        let cert = this._externalCert[port];
        if (cert) {
            return ObjectUtil_1.default.cloneDeep(cert);
        }
        let tempCert = ObjectUtil_1.default.cloneDeep(this._tempCert);
        tempCert.cert.name = `external.${port}.cert.pem`;
        tempCert.key.name = `external.${port}.key.pem`;
        return tempCert;
    }
    getAllExternalCert() {
        return ObjectUtil_1.default.cloneDeep(this._externalCert);
    }
    async save(file, data) {
        let strData = typeof data == 'string' ? data : JSON.stringify(data, null, 4);
        let parent = file.getParentFile();
        if (!parent.exists()) {
            parent.mkdirs();
        }
        if (file.isFile()) {
            file.delete();
            file.createNewFile();
        }
        await Files_1.default.write(file, strData);
    }
    async writeCertFile(info, type) {
        const dir = type == 'admin' ? Environment_1.default.path.adminCertDir : Environment_1.default.path.externalCertDir;
        if (!new File_1.default(dir).exists()) {
            new File_1.default(dir).mkdirs();
        }
        if (info.key.name != '' && info.key.value != '') {
            await this.save(new File_1.default(dir, info.key.name), info.key.value);
        }
        if (info.cert.name != '' && info.cert.value != '') {
            await this.save(new File_1.default(dir, info.cert.name), info.cert.value);
        }
        if (info.ca.name != '' && info.ca.value != '') {
            await this.save(new File_1.default(dir, info.ca.name), info.ca.value);
        }
    }
    removeCertFile(info, type) {
        const dir = type == 'admin' ? Environment_1.default.path.adminCertDir : Environment_1.default.path.externalCertDir;
        if (info.key.name != '') {
            new File_1.default(dir, info.key.name).delete();
        }
        if (info.cert.name != '') {
            new File_1.default(dir, info.cert.name).delete();
        }
        if (info.ca.name != '') {
            new File_1.default(dir, info.ca.name).delete();
        }
    }
    async updateAdminServerCert(certInfo) {
        if (!this.checkKeyPair(certInfo)) {
            return false;
        }
        this.removeCertFile(this._adminCert, 'admin');
        this._adminCert = certInfo;
        await this.save(this._adminCertFile, this._adminCert);
        await this.writeCertFile(this._adminCert, 'admin');
        return true;
    }
    async updateExternalServerCert(port, certInfo) {
        if (!this.checkKeyPair(certInfo)) {
            return false;
        }
        let oldInfo = this._externalCert[port];
        if (oldInfo) {
            this.removeCertFile(oldInfo, 'external');
        }
        this._externalCert[port] = certInfo;
        await this.save(this._externalCertFile, this._externalCert);
        await this.writeCertFile(this._externalCert[port], 'external');
        return true;
    }
    async removeForExternalServer(port) {
        let oldInfo = this._externalCert[port];
        if (oldInfo) {
            this.removeCertFile(oldInfo, 'external');
        }
        delete this._externalCert[port];
        await this.save(this._externalCertFile, this._externalCert);
    }
    async removeForAdminServer() {
        this.removeCertFile(this._adminCert, 'admin');
        this._adminCert = CertificationStore.makeEmptyCertFileInfo();
        await this.save(this._adminCertFile, this._adminCert);
    }
    async saveForExternalServer(port, certInfo) {
        if (!this.checkKeyPair(certInfo)) {
            return false;
        }
        let oldInfo = this._externalCert[port];
        if (oldInfo) {
            this.removeCertFile(oldInfo, 'external');
        }
        this._externalCert[port] = certInfo;
        await this.save(this._externalCertFile, this._externalCert);
        await this.writeCertFile(this._externalCert[port], 'external');
        return true;
    }
    async loadExternalCert() {
        let file = new File_1.default(Environment_1.default.path.certDir, EXTERNAL_CERT_FILE_INFO_FILE_NAME);
        if (file.exists()) {
            let data = await Files_1.default.toString(file);
            if (data) {
                this._externalCert = JSON.parse(data);
            }
            else {
                this._externalCert = {};
            }
        }
    }
    async loadAdminCert() {
        let file = new File_1.default(Environment_1.default.path.certDir, ADMIN_CERT_FILE_INFO_FILE_NAME);
        if (file.exists()) {
            let data = await Files_1.default.toString(file);
            if (data) {
                this._adminCert = JSON.parse(data);
            }
        }
        else {
            let cert = await CACertGenerator_1.default.genCACert();
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
    checkKeyPair(cert) {
        return CertificationStore.isValidCertificate(cert.cert.value) &&
            CertificationStore.isValidPrivateKey(cert.key.value) &&
            (cert.ca.value == '' || CertificationStore.isValidCertificate(cert.ca.value))
            && this.validateKeyPair(cert.key.value, cert.cert.value);
    }
    validateKeyPair(privateKey, certificate) {
        try {
            const certificateObject = node_forge_1.default.pki.certificateFromPem(certificate);
            const privateKeyObject = node_forge_1.default.pki.privateKeyFromPem(privateKey);
            const plain = crypto_js_1.default.SHA512(Date.now() + '@').toString();
            let encrypted = certificateObject.publicKey.encrypt(plain, 'RSA-OAEP', {
                md: node_forge_1.default.md.sha256.create(),
                mgf1: {
                    md: node_forge_1.default.md.sha256.create()
                }
            });
            let decrypted = privateKeyObject.decrypt(encrypted, 'RSA-OAEP', {
                md: node_forge_1.default.md.sha256.create(),
                mgf1: {
                    md: node_forge_1.default.md.sha256.create()
                }
            });
            return decrypted == plain;
        }
        catch (error) {
            logger.error('Key pair does not match.', error);
            return false;
        }
    }
    static isValidPrivateKey(pemPrivateKey) {
        pemPrivateKey = pemPrivateKey.trim();
        if ((!pemPrivateKey.startsWith('-----BEGIN PRIVATE KEY') || !pemPrivateKey.endsWith('END PRIVATE KEY-----')) &&
            (!pemPrivateKey.startsWith('-----BEGIN RSA PRIVATE KEY') || !pemPrivateKey.endsWith('END RSA PRIVATE KEY-----'))) {
            logger.error('Private key format is incorrect.');
            return false;
        }
        try {
            const privateKeyObject = node_forge_1.default.pki.privateKeyFromPem(pemPrivateKey);
            if (privateKeyObject.n.bitLength() < 2048) {
                logger.error('Private key length is short.');
                return false;
            }
        }
        catch (error) {
            logger.error('Private key format is incorrect.', error);
            return false;
        }
        return true;
    }
    static isValidCertificate(pemPublicKey) {
        pemPublicKey = pemPublicKey.trim();
        if (!pemPublicKey.startsWith('-----BEGIN CERTIFICATE') || !pemPublicKey.endsWith('END CERTIFICATE-----')) {
            logger.error('Certificate(pem) format is incorrect.');
            return false;
        }
        try {
            const certificate = node_forge_1.default.pki.certificateFromPem(pemPublicKey);
            if (certificate.publicKey && certificate.publicKey.n.bitLength() < 2048) {
                logger.error('Public key length is short.');
                return false;
            }
        }
        catch (error) {
            logger.error('Certificate(pem) format is incorrect.', error);
            return false;
        }
        return true;
    }
}
exports.CertificationStore = CertificationStore;
