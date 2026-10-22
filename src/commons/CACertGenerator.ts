import forge from 'node-forge';
import crypto from 'crypto';
const pki = forge.pki

type CACert = {
    key: string;
    cert: string;
    fingerprint: string;
}
class CACertGenerator {

    public static result : CACert | null = null

    public static async genCACert(options: any = {}): Promise<CACert> {
        options = {
            ...{
                commonName: 'Testing CA - DO NOT TRUST',
                bits: 2048,
            },
            ...options,
        };


        const keyPair = await new Promise<forge.pki.KeyPair>((res, rej) => {
            pki.rsa.generateKeyPair({ bits: options.bits }, (error, pair) => {
                if (error) rej(error);
                else res(pair);
            });
        });

        const cert = pki.createCertificate();
        cert.publicKey = keyPair.publicKey;
        cert.serialNumber = crypto.randomUUID().replace(/-/g, '');

        cert.validity.notBefore = new Date();
        cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

        cert.setSubject([{ name: 'commonName', value: options.commonName }]);
        const extensions: any[] = [{ name: 'basicConstraints', cA: true }];
        if(Array.isArray(options.altNames) && options.altNames.length > 0) {
            // type 2 = dNSName. 클라이언트가 고정 서버 이름으로 검증할 수 있게 한다(#212).
            extensions.push({ name: 'subjectAltName', altNames: options.altNames.map((value: string) => ({ type: 2, value })) });
        }
        cert.setExtensions(extensions);

        cert.setIssuer(cert.subject.attributes);
        cert.sign(keyPair.privateKey, forge.md.sha256.create());

        CACertGenerator.result = {
            key: pki.privateKeyToPem(keyPair.privateKey).toString(),
            cert: pki.certificateToPem(cert),
            fingerprint: forge.util.encode64(
                pki.getPublicKeyFingerprint(keyPair.publicKey, {
                    type: 'SubjectPublicKeyInfo',
                    md: forge.md.sha256.create(),
                    encoding: 'binary',
                })
            )
        };
        return CACertGenerator.result;

    }


}


export default CACertGenerator;