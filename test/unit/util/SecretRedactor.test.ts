import {REDACTED_VALUE, redactSecrets} from "../../../src/util/SecretRedactor";

describe("SecretRedactor", () => {
    it("redacts common secret fields while preserving surrounding structure", () => {
        const result = redactSecrets({
            key: "shared-secret",
            certInfo: {
                cert: "cert-pem",
                key: "private-key-pem",
                ca: "ca-pem"
            },
            nested: [
                {
                    bootstrapToken: "token"
                }
            ],
            host: "127.0.0.1"
        });

        expect(result).toEqual({
            key: REDACTED_VALUE,
            certInfo: {
                cert: REDACTED_VALUE,
                key: REDACTED_VALUE,
                ca: REDACTED_VALUE
            },
            nested: [
                {
                    bootstrapToken: REDACTED_VALUE
                }
            ],
            host: "127.0.0.1"
        });
    });
    it("일회용 코드 계열 키도 마스킹한다", () => {
        const result = redactSecrets({totp: "1", code: "2", recoveryCode: "3", Code: "4", keep: "5"});

        expect(result).toEqual({
            totp: REDACTED_VALUE,
            code: REDACTED_VALUE,
            recoveryCode: REDACTED_VALUE,
            Code: REDACTED_VALUE,
            keep: "5"
        });
    });
});
