const REDACTED_VALUE = "[REDACTED]";

const isSensitiveKey = (key: string): boolean => {
    const normalized = key.trim().toLowerCase();
    return normalized == "key"
        || normalized == "clientsecret"
        || normalized == "cert"
        || normalized == "ca"
        || normalized == "password"
        || normalized == "sessionkey"
        || normalized == "bootstraptoken"
        || normalized.endsWith("secret")
        || normalized.endsWith("token")
        || normalized.endsWith("password")
        || normalized.endsWith("privatekey");
};

const redactSecrets = (value: any): any => {
    if(Array.isArray(value)) {
        return value.map((item) => redactSecrets(item));
    }
    if(value == undefined || value == null) {
        return value;
    }
    if(typeof value != "object") {
        return value;
    }

    const result: any = {};
    Object.entries(value).forEach(([key, itemValue]) => {
        if(isSensitiveKey(key) && itemValue != undefined && itemValue !== "") {
            result[key] = REDACTED_VALUE;
            return;
        }
        result[key] = redactSecrets(itemValue);
    });
    return result;
};

/**
 * R2-REQ-05 — 문자열 레벨 민감정보 redact.
 *
 * `Errors.toString` / 로거 최종 write 경로에서 사용. 정규식 화이트리스트:
 *  - Authorization 헤더 값
 *  - PEM 블록 전체
 *  - `key|token|secret|password|authkey` 키워드 = 값
 *  - bcrypt 해시 ($2a$/$2b$/$2y$ prefix)
 *  - hex 64자 이상 (git SHA 40자 미만 오탐 방지)
 */
const SECRET_PATTERNS: Array<RegExp> = [
    /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
    /authorization:\s*\S+/gi,
    /\b(key|token|secret|password|authkey)\s*[:=]\s*\S+/gi,
    /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g,
    /\b[a-f0-9]{64,}\b/gi
];

const redactSecretString = (text: string): string => {
    if(typeof text !== "string" || text.length === 0) return text;
    let out = text;
    for(const re of SECRET_PATTERNS) {
        out = out.replace(re, REDACTED_VALUE);
    }
    return out;
};

export { REDACTED_VALUE, redactSecrets, redactSecretString };
