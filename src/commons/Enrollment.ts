import * as crypto from "crypto";

/**
 * 신뢰 클라이언트 등록 코드와 교환 응답 봉인(#212·#214).
 *
 * 클라이언트는 코드 원문을 서버로 보내지 않는다. 코드에서 scrypt 로 64바이트를 유도해 앞 32바이트는
 * 조회값(lookup)으로 보내고, 뒤 32바이트는 AES-256-GCM 키로 쓴다. 서버는 발급할 때 같은 값을 유도해
 * 조회값과 키만 기억하고 코드는 버린다. 응답은 그 키로 봉인하므로, 코드를 모르는 중간자는 응답을 읽거나
 * 만들 수 없다. 이것이 교환 응답의 서버 증명이다(#212 REQ-6). scrypt 는 가로챈 조회값으로 코드를
 * 대입해 보는 일을 느리게 만든다.
 */
const ENROLLMENT_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford Base32: I, L, O, U 없음
const ENROLLMENT_CODE_LENGTH = 12; // 12 × 5비트 = 60비트
const ENROLLMENT_PROTOCOL = "tttgate-enroll-v1";
const SCRYPT_PARAMS = {N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024};

type EnrollmentKeys = {lookup: string, key: Buffer};
type SealedEnrollmentPayload = {nonce: string, ciphertext: string, tag: string};

const generateEnrollmentCode = (): string => {
    const symbols: string[] = [];
    for(let n = 0; n < ENROLLMENT_CODE_LENGTH; n++) {
        symbols.push(ENROLLMENT_CODE_ALPHABET[crypto.randomInt(ENROLLMENT_CODE_ALPHABET.length)]);
    }
    const text = symbols.join("");
    return `${text.slice(0, 4)}-${text.slice(4, 8)}-${text.slice(8, 12)}`;
};

/** 대소문자·공백·대시를 무시하고, 헷갈리는 글자(O→0, I·L→1)를 바꾼다. 형식이 틀리면 undefined. */
const normalizeEnrollmentCode = (input: string): string | undefined => {
    const text = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
    if(text.length !== ENROLLMENT_CODE_LENGTH) return undefined;
    for(const symbol of text) {
        if(!ENROLLMENT_CODE_ALPHABET.includes(symbol)) return undefined;
    }
    return text;
};

const deriveEnrollmentKeys = (code: string): Promise<EnrollmentKeys> => {
    const normalized = normalizeEnrollmentCode(code);
    if(!normalized) return Promise.reject(new Error("invalid enrollment code format"));
    return new Promise((resolve, reject) => {
        crypto.scrypt(normalized, ENROLLMENT_PROTOCOL, 64, SCRYPT_PARAMS, (err, derived) => {
            if(err) return reject(err);
            resolve({lookup: derived.subarray(0, 32).toString("hex"), key: Buffer.from(derived.subarray(32, 64))});
        });
    });
};

const aadOf = (lookup: string): Buffer => Buffer.from(`${ENROLLMENT_PROTOCOL}|${lookup}`, "utf-8");

const sealEnrollmentPayload = (keys: EnrollmentKeys, payload: object): SealedEnrollmentPayload => {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", keys.key, nonce);
    cipher.setAAD(aadOf(keys.lookup));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf-8"), cipher.final()]);
    return {nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64")};
};

/** 봉인을 연다. 키·조회값·내용 중 하나라도 맞지 않으면 undefined(서버 증명 실패). */
const openEnrollmentPayload = (keys: EnrollmentKeys, sealed: SealedEnrollmentPayload): unknown => {
    try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", keys.key, Buffer.from(sealed.nonce, "base64"));
        decipher.setAAD(aadOf(keys.lookup));
        decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
        const plain = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]);
        return JSON.parse(plain.toString("utf-8"));
    } catch {
        return undefined;
    }
};

export {
    ENROLLMENT_CODE_ALPHABET,
    ENROLLMENT_PROTOCOL,
    EnrollmentKeys,
    SealedEnrollmentPayload,
    generateEnrollmentCode,
    normalizeEnrollmentCode,
    deriveEnrollmentKeys,
    sealEnrollmentPayload,
    openEnrollmentPayload
};
