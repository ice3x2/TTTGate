/**
 * 테스트용 자체서명 인증서 동적 생성 헬퍼.
 * Mock 금지 원칙: node-forge (production dependency) 기반 실제 X.509 발급.
 *
 * 사용처:
 *  - REQ-02 TLS 설정 테스트 (test/security/req-02-tls-settings.test.ts)
 *  - REQ-08 cert hot-apply 테스트 (test/security/req-08-admin-cert-hotapply.test.ts)
 */
import * as forge from "node-forge";
import * as crypto from "crypto";

export type TestCertBundle = {
    keyPem: string;
    certPem: string;
    fingerprintSha256: string;
    commonName: string;
};

export function generateSelfSignedCert(commonName: string = "localhost"): TestCertBundle {
    const pki = forge.pki;
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    // crypto.randomBytes 기반 예측 불가 serial (node-forge는 16진 문자열 요구).
    // 앞바이트에 0을 강제하여 최상위 비트가 1로 해석될 때 부호 있는 정수로 처리되는 케이스를 회피.
    cert.serialNumber = "00" + crypto.randomBytes(8).toString("hex");
    const now = new Date();
    cert.validity.notBefore = new Date(now.getTime() - 60_000);
    cert.validity.notAfter = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const attrs = [
        { name: "commonName", value: commonName },
        { name: "countryName", value: "KR" },
        { name: "organizationName", value: "TTTGateTest" }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
        { name: "basicConstraints", cA: true },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true, keyCertSign: true },
        {
            name: "subjectAltName",
            altNames: [
                { type: 2, value: "localhost" },
                { type: 7, ip: "127.0.0.1" }
            ]
        }
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const certPem = pki.certificateToPem(cert);
    const keyPem = pki.privateKeyToPem(keys.privateKey);
    const der = forge.asn1.toDer(pki.certificateToAsn1(cert)).getBytes();
    const fp = forge.md.sha256.create();
    fp.update(der);
    const fingerprintSha256 = fp.digest().toHex();
    return { keyPem, certPem, fingerprintSha256, commonName };
}
