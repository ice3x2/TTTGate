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
});
