"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_forge_1 = __importDefault(require("node-forge"));
const crypto_1 = __importDefault(require("crypto"));
const pki = node_forge_1.default.pki;
class CACertGenerator {
    static result = null;
    static async genCACert(options = {}) {
        options = {
            ...{
                commonName: 'Testing CA - DO NOT TRUST',
                bits: 2048,
            },
            ...options,
        };
        const keyPair = await new Promise((res, rej) => {
            pki.rsa.generateKeyPair({ bits: options.bits }, (error, pair) => {
                if (error)
                    rej(error);
                else
                    res(pair);
            });
        });
        const cert = pki.createCertificate();
        cert.publicKey = keyPair.publicKey;
        cert.serialNumber = crypto_1.default.randomUUID().replace(/-/g, '');
        cert.validity.notBefore = new Date();
        cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
        cert.setSubject([{ name: 'commonName', value: options.commonName }]);
        cert.setExtensions([{ name: 'basicConstraints', cA: true }]);
        cert.setIssuer(cert.subject.attributes);
        cert.sign(keyPair.privateKey, node_forge_1.default.md.sha256.create());
        CACertGenerator.result = {
            key: pki.privateKeyToPem(keyPair.privateKey).toString(),
            cert: pki.certificateToPem(cert),
            fingerprint: node_forge_1.default.util.encode64(pki.getPublicKeyFingerprint(keyPair.publicKey, {
                type: 'SubjectPublicKeyInfo',
                md: node_forge_1.default.md.sha256.create(),
                encoding: 'binary',
            }))
        };
        return CACertGenerator.result;
    }
}
exports.default = CACertGenerator;
