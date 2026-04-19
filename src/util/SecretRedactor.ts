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

export { REDACTED_VALUE, redactSecrets };
