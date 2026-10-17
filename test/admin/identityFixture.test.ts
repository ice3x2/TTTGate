import YAML from "yaml";
import {serializeIdentityFixture} from "../helpers/identityFixture";

// U3-01 / #103 — identityFixture 의 고정 id 와 migratedFromLegacyAdmin. npm run test:admin 이 test/admin 만 돌리므로 여기 둔다.
jest.setTimeout(30_000);

const userOf = (yaml: string, username: string) => YAML.parse(yaml).users.find((user: any) => user.username === username);

describe("identityFixture", () => {
    test("고정 id 를 그대로 쓴다", async () => {
        const yaml = await serializeIdentityFixture({users: [{id: "u_0000000000000009", username: "admin", password: "test-password-1234", role: "superuser"}]});
        expect(yaml).toContain("id: u_0000000000000009");
    });

    test("형식에 맞지 않는 id 는 던진다", async () => {
        await expect(serializeIdentityFixture({users: [{id: "bad", username: "admin", password: "test-password-1234", role: "superuser"}]}))
            .rejects.toThrow();
        await expect(serializeIdentityFixture({users: [{id: "u_alice", username: "admin", password: "test-password-1234", role: "superuser"}]}))
            .rejects.toThrow();
    });

    test("migratedFromLegacyAdmin 을 쓰고 migrationAcknowledged 는 늘 false 다", async () => {
        const yaml = await serializeIdentityFixture({users: [
            {username: "admin", password: "test-password-1234", role: "superuser", migratedFromLegacyAdmin: true},
            {username: "bob", password: "user-password-1234", role: "regular"}
        ]});
        expect(userOf(yaml, "admin")).toMatchObject({migratedFromLegacyAdmin: true, migrationAcknowledged: false});
        expect(userOf(yaml, "bob")).toMatchObject({migratedFromLegacyAdmin: false, migrationAcknowledged: false});
    });
});
