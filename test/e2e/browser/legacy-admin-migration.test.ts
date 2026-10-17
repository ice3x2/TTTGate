// U2-09 / #101: 레거시 `.key` 만 있는 서버가 새 바이너리로 기동해 `admin` 이 슈퍼유저로 승격되는 경로를
// 실제 프로세스와 브라우저로 고정한다(PRD K2).
//
// 이 파일의 테스트는 순서에 의존한다. 하나의 하네스를 공유하며, "restart" 케이스가
// 서버 프로세스를 교체하므로 그 앞의 케이스들이 먼저 돌아야 한다. jest 의 선언 순서대로 실행된다.
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import YAML from "yaml";
import {startTargetService, TargetService} from "../target/targetService";
import {ADMIN_PASSWORD_HASH, createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";
import {startAdminBrowser} from "../../helpers/adminBrowser";
import {E2E_ADMIN_PASSWORD} from "../../helpers/identityFixture";
import {MIGRATED_OWNER_ID} from "../../../src/server/rbac/IdentityTypes";

jest.setTimeout(180_000);

const MIGRATION_LOG_MARKER = "identity migrated from legacy admin key";

const occurrences = (text: string, marker: string): number => text.split(marker).length - 1;

describe("legacy-admin-migration", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;
    let configDir: string;
    let firstBootStdout: string;

    beforeAll(async () => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({
            tunnels: [{protocol: "tcp", destinationPort: target.port}],
            startClient: false
        });
        configDir = path.join(harness.rootDir, "config");
        // restartServer() 가 harness.server 를 새 자식 프로세스로 교체하므로 첫 기동 stdout 을 지금 담아 둔다.
        firstBootStdout = harness.server.readChannel().stdout;
    });

    afterAll(async () => {
        try {
            await harness?.dispose();
        } finally {
            await target?.close();
        }
    });

    test("boot promotes the legacy admin key into identity.yaml and keeps the key file", () => {
        const identityPath = path.join(configDir, "identity.yaml");
        expect(fs.existsSync(identityPath)).toBe(true);
        const identity = YAML.parse(fs.readFileSync(identityPath, "utf-8"));
        expect(identity.users).toHaveLength(1);
        const admin = identity.users[0];
        expect(admin.username).toBe("admin");
        expect(admin.migratedFromLegacyAdmin).toBe(true);
        expect(admin.role).toBe("superuser");

        const keyPath = path.join(configDir, ".key");
        expect(fs.existsSync(keyPath)).toBe(true);
        const keyContent = fs.readFileSync(keyPath, "utf-8");
        // `.key` 가 기동 전과 같다는 것을 하네스가 심은 해시 원문과 대조해 고정한다.
        // bcrypt 는 salt 가 해시 안에 들어 있어 compareSync 만으로는 같은 평문을 다시 해시해
        // 덮어쓴 경우를 가려낼 수 없다. 그래서 원문 일치를 먼저 보고, 승격된 해시가 그것과
        // 같은지도 함께 본다.
        expect(keyContent.trim()).toBe(ADMIN_PASSWORD_HASH);
        expect(admin.passwordHash).toBe(ADMIN_PASSWORD_HASH);
        expect(bcrypt.compareSync(E2E_ADMIN_PASSWORD, keyContent.trim())).toBe(true);

        expect(fs.existsSync(path.join(configDir, ".bootstrap-token"))).toBe(false);
    });

    test("the promotion is logged exactly once on the first boot", () => {
        expect(occurrences(firstBootStdout, MIGRATION_LOG_MARKER)).toBe(1);
    });

    test("the migrated admin owns no tunnel and sees the migration banner", async () => {
        const tunnels = await harness.adminRequest("/api/tunnelingOption");
        expect(tunnels.status).toBe(200);
        expect(tunnels.json.tunnelingOptions).toHaveLength(1);
        expect(tunnels.json.tunnelingOptions[0].owner).toEqual({id: MIGRATED_OWNER_ID});

        const me = await harness.adminRequest("/api/me");
        expect(me.status).toBe(200);
        expect(me.json.migrationBanner).toBe(true);
        expect(me.json.user.username).toBe("admin");
    });

    test("the legacy password signs in through the admin UI", async () => {
        const app = await startAdminBrowser({apiOrigin: `https://127.0.0.1:${harness.adminPort}`});
        try {
            const page = app.page;
            await page.goto(app.url);
            const password = page.locator("#login-password");
            await password.waitFor({state: "visible"});
            await page.locator("#login-username").fill("admin");
            await password.fill(E2E_ADMIN_PASSWORD);
            await page.getByRole("button", {name: "OK", exact: true}).click();
            await page.waitForFunction(() => location.hash === "#/status");
            await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Status");
            const sessionStatus = await page.evaluate(async () => (await fetch("/api/validateSession")).status);
            expect(sessionStatus).toBe(200);
            expect(app.errors).toEqual([]);
        } finally {
            await app.close();
        }
    });

    test("restart neither rewrites identity.yaml nor promotes again", async () => {
        const identityPath = path.join(configDir, "identity.yaml");
        const mtimeBefore = fs.statSync(identityPath).mtimeMs;

        await harness.restartServer();

        expect(fs.statSync(identityPath).mtimeMs).toBe(mtimeBefore);
        expect(fs.existsSync(path.join(configDir, ".key"))).toBe(true);
        expect(occurrences(harness.server.readChannel().stdout, MIGRATION_LOG_MARKER)).toBe(0);

        const me = await harness.adminRequest("/api/me");
        expect(me.status).toBe(200);
        expect(me.json.user.username).toBe("admin");
    });
});
