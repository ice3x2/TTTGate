// U2-09 / #101: identityFixture 로 사용자·그룹을 미리 심은 서버에서 일반 유저가 보는 범위를 고정한다.
// `.key` 가 없으므로 레거시 승격 경로를 타지 않고, 일반 유저는 server 섹션도 남의 터널도 보지 못한다.
//
// 이 파일의 테스트는 순서에 의존하지 않는다. 하나의 하네스를 공유하지만 아무 케이스도 서버 상태를 바꾸지 않는다.
import fs from "fs";
import path from "path";
import YAML from "yaml";
import {startTargetService, TargetService} from "../target/targetService";
import {AdminRequest, createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";
import {startAdminBrowser} from "../../helpers/adminBrowser";
import {E2E_ADMIN_PASSWORD, IdentityFixture} from "../../helpers/identityFixture";
import {isBcryptHash} from "../../../src/server/rbac/IdentityTypes";

jest.setTimeout(180_000);

const ALICE_PASSWORD = "alice-pass-1234";

const FIXTURE: IdentityFixture = {
    users: [
        {username: "admin", password: E2E_ADMIN_PASSWORD, role: "superuser"},
        {username: "alice", password: ALICE_PASSWORD, role: "regular", groupId: "g_field"}
    ],
    groups: [
        {id: "g_field", name: "Field", attributes: {allowed_port_range: [{from: 20000, to: 20099}], allowed_protocols: ["TCP"]}}
    ]
};

describe("regular-user-login", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let configDir: string;
    let asAlice: AdminRequest;

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({
            tunnels: [{protocol: "tcp", destinationPort: target.port}],
            startClient: false,
            identityFixture: FIXTURE
        });
        configDir = path.join(harness.rootDir, "config");
        asAlice = harness.adminRequestAs({username: "alice", password: ALICE_PASSWORD});
    });

    afterAll(async () => {
        try {
            await harness?.dispose();
        } finally {
            await target?.close();
        }
    });

    test("the fixture replaces the legacy key file and stores only bcrypt hashes", () => {
        expect(fs.existsSync(path.join(configDir, ".key"))).toBe(false);
        const raw = fs.readFileSync(path.join(configDir, "identity.yaml"), "utf-8");
        const identity = YAML.parse(raw);
        expect(identity.version).toBe(1);
        expect(identity.users.map((user: {username: string}) => user.username).sort()).toEqual(["admin", "alice"]);
        const alice = identity.users.find((user: {username: string}) => user.username === "alice");
        expect(alice.role).toBe("regular");
        expect(alice.groupId).toBe("g_field");
        expect(isBcryptHash(alice.passwordHash)).toBe(true);
        // 평문 비밀번호는 저장 파일에 값으로 남지 않는다.
        expect(raw).not.toContain(ALICE_PASSWORD);
        expect(raw).not.toContain(E2E_ADMIN_PASSWORD);

        const group = identity.groups.find((candidate: {id: string}) => candidate.id === "g_field");
        expect(group.name).toBe("Field");
        expect(group.attributes.allowed_port_range).toEqual([{from: 20000, to: 20099}]);
        expect(group.attributes.allowed_protocols).toEqual(["TCP"]);
    });

    test("a regular user gets her own session and no server section", async () => {
        const me = await asAlice("/api/me");
        expect(me.status).toBe(200);
        expect(me.json.user.username).toBe("alice");
        expect(me.json.group.id).toBe("g_field");
        // not.toContain 의 전제를 같은 케이스 안에서 고정한다: 섹션 목록이 비어 있지 않고 tunnels 를 담고 있다.
        expect(me.json.sections).toContain("tunnels");
        expect(me.json.sections).not.toContain("server");

        const adminMe = await harness.adminRequest("/api/me");
        expect(adminMe.status).toBe(200);
        expect(adminMe.json.user.username).toBe("admin");
        expect(adminMe.json.sections).toContain("server");
    });

    test("the migrated tunnel is invisible to the regular user but visible to the superuser", async () => {
        const aliceTunnels = await asAlice("/api/tunnelingOption");
        expect(aliceTunnels.status).toBe(200);
        expect(aliceTunnels.json.tunnelingOptions).toEqual([]);

        const adminTunnels = await harness.adminRequest("/api/tunnelingOption");
        expect(adminTunnels.status).toBe(200);
        expect(adminTunnels.json.tunnelingOptions).toHaveLength(1);
        expect(adminTunnels.json.tunnelingOptions[0].forwardPort).toBe(harness.tunnels[0].forwardPort);
    });

    test("alice signs in through the admin UI and /api/me reports alice", async () => {
        const app = await startAdminBrowser({apiOrigin: `https://127.0.0.1:${harness.adminPort}`});
        try {
            const page = app.page;
            await page.goto(app.url);
            const password = page.locator("#login-password");
            await password.waitFor({state: "visible"});
            await page.locator("#login-username").fill("alice");
            await password.fill(ALICE_PASSWORD);
            await page.getByRole("button", {name: "OK", exact: true}).click();
            await page.waitForFunction(() => location.hash.startsWith("#/"));
            const me = await page.evaluate(async () => {
                const response = await fetch("/api/me");
                return {status: response.status, body: await response.json()};
            });
            expect(me.status).toBe(200);
            expect(me.body.user.username).toBe("alice");
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });
});
