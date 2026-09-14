import {generateTemporaryPassword} from "../../../../src/server/rbac/temporaryPassword";

describe("generateTemporaryPassword", () => {
    it("기본 길이는 16 이고 영숫자만 쓴다", () => {
        const password = generateTemporaryPassword();
        expect(password).toHaveLength(16);
        expect(password).toMatch(/^[A-Za-z0-9]+$/);
    });

    it("100회 호출 결과가 모두 서로 다르다", () => {
        const generated = new Set<string>();
        for(let index = 0; index < 100; index++) {
            generated.add(generateTemporaryPassword());
        }
        expect(generated.size).toBe(100);
    });

    it("길이를 지정하면 그 길이로 만든다", () => {
        const password = generateTemporaryPassword(24);
        expect(password).toHaveLength(24);
        expect(password).toMatch(/^[A-Za-z0-9]+$/);
    });
});
