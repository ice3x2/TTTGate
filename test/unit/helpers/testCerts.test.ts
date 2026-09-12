/**
 * generateSelfSignedCert() 가 항상 유효한 DER 을 담은 인증서/키 쌍을 돌려주는지 검증.
 *
 * 배경(GitHub #132): node-forge@1.4.0 의 인증서 ASN.1 직렬화가 약 1/750 확률로
 * 유효하지 않은 DER 을 만들어 `new crypto.X509Certificate(certPem)` 이 던진다.
 * 200회 반복은 그 확률을 안정적으로 잡아내지 못할 수 있어, red 확인 시에는
 * 반복 횟수를 일시적으로 3,000회까지 올려 실패를 직접 확인해야 한다.
 */
import * as crypto from "crypto";
import * as tls from "tls";
import { generateSelfSignedCert } from "../../helpers/testCerts";

jest.setTimeout(120_000);

const REPEAT_COUNT = 200;

test(`generateSelfSignedCert() 가 반환한 certPem 은 ${REPEAT_COUNT}회 반복해도 항상 X509Certificate 로 파싱된다`, () => {
    for (let i = 0; i < REPEAT_COUNT; i++) {
        const { certPem } = generateSelfSignedCert();
        expect(() => new crypto.X509Certificate(certPem)).not.toThrow();
    }
});

test(`generateSelfSignedCert() 가 반환한 keyPem 은 ${REPEAT_COUNT}회 반복해도 항상 createPrivateKey 로 파싱된다`, () => {
    for (let i = 0; i < REPEAT_COUNT; i++) {
        const { keyPem } = generateSelfSignedCert();
        expect(() => crypto.createPrivateKey(keyPem)).not.toThrow();
    }
});

test(`generateSelfSignedCert() 가 반환한 인증서와 키는 짝이 맞아 ${REPEAT_COUNT}회 중 표본 10개에서 createSecureContext 가 던지지 않는다`, () => {
    const sampleInterval = Math.floor(REPEAT_COUNT / 10);
    for (let i = 0; i < REPEAT_COUNT; i++) {
        const { certPem, keyPem } = generateSelfSignedCert();
        if (i % sampleInterval === 0) {
            expect(() => tls.createSecureContext({ cert: certPem, key: keyPem })).not.toThrow();
        }
    }
});
