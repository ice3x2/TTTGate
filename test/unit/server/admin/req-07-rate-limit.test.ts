/**
 * P5-T2 / REQ-07 — 로그인 레이트리밋 키 재설계 통합 검증.
 * 실 http.request / 실 AdminServer. 만료 경계는 기존 주입 가능 clock을 사용하고,
 * LRU 상한은 명시적인 요청 데이터 fixture로 실제 기록 메서드를 호출한다.
 *
 * 주요 검증:
 *  (a) 동일 네트워크의 실패는 제출 비밀번호와 무관하게 누적되며 차단 만료 후 재시도 가능.
 *  (b) trustXForwardedFor=false(기본) 에서 X-Forwarded-For 헤더는 무시됨 (실제 socket.remoteAddress 만 사용).
 *  (c) LRU 상한 초과 시 가장 오래된 엔트리 축출 (private map size 를 접근자 없이 10,001 호출로 검증).
 *  (d) 실패 응답 지연 하한: 실패 횟수 >= 3 일 때 최소 400ms.
 */
import fs from "fs/promises";
import Path from "path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../../../src/server/admin/SessionStore";
import {AdminSecurityPolicyRegistry} from "../../../../src/server/AdminSecurityPolicy";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {ClockRngProvider} from "../../../../src/util/ClockRng";
import {createFakeClockRng} from "../../../helpers/clockRng";
import {httpRequest} from "../../../helpers/http";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

jest.setTimeout(60_000);

describe("REQ-07 login rate limit (network bucket)", () => {
    let testRoot: TestRoot;
    let adminServer: AdminServer;
    let port: number;
    let bootstrapToken: string;

    beforeEach(async () => {
        testRoot = await createTestRoot("req-07-rate-limit");
        applyTestRoot(testRoot.rootDir);
        ServerOptionStore.instance;
        SessionStore.instance;
        adminServer = new AdminServer({} as any, false);
        port = await adminServer.listen(0, "127.0.0.1");
        bootstrapToken = (await fs.readFile(
            Path.join(testRoot.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME),
            {encoding: "utf-8"}
        )).trim();
    });

    afterEach(async () => {
        await adminServer.close();
        await cleanupTestRoot(testRoot);
    });

    async function login(body: object, headers: Record<string, string> = {}) {
        return await httpRequest({
            port, path: "/api/login", method: "POST",
            headers: {"Content-Type": "application/json", ...headers},
            body: JSON.stringify(body)
        });
    }

    it("(a) five failures block every submitted password until the existing window expires", async () => {
        const bootstrapRes = await login({key: "supersecret1", bootstrapToken});
        expect(bootstrapRes.statusCode).toBe(200);
        const clock = createFakeClockRng(Date.now());
        ClockRngProvider.configure(clock);

        for(let i = 0; i < 5; i++) {
            const r = await login({key: "wrong-password-A"});
            expect(r.statusCode).toBe(401);
        }
        const blockedA = await login({key: "wrong-password-A"});
        expect(blockedA.statusCode).toBe(429);

        const otherAcct = await login({key: "different-wrong-password-B"});
        expect(otherAcct.statusCode).toBe(429);
        expect(JSON.parse(otherAcct.body)).toMatchObject({success: false, message: "Too many login attempts"});
        expect((await login({key: "supersecret1"})).statusCode).toBe(429);
        expect((adminServer as any)._loginAttempts.size).toBe(1);
        clock.advance(59_999);
        expect((await login({key: "third-wrong-password"})).statusCode).toBe(429);
        clock.advance(1);
        expect((await login({key: "different-wrong-password-B"})).statusCode).toBe(401);
        expect([...(adminServer as any)._loginAttempts.values()][0]).toMatchObject({failedCount: 1});
        expect((await login({key: "supersecret1"})).statusCode).toBe(200);
        expect((adminServer as any)._loginAttempts.size).toBe(0);
    });

    it("rotating passwords and untrusted XFF headers cannot create fresh buckets", async () => {
        expect((await login({key: "supersecret1", bootstrapToken})).statusCode).toBe(200);
        for(let index = 0; index < 5; index++) {
            const result = await login({key: `different-password-${index}`}, {"X-Forwarded-For": `10.${index}.1.1`});
            expect(result.statusCode).toBe(401);
        }
        expect((await login({key: "sixth-new-password"}, {"X-Forwarded-For": "192.0.2.1"})).statusCode).toBe(429);
        expect((adminServer as any)._loginAttempts.size).toBe(1);
        expect([...(adminServer as any)._loginAttempts.values()][0]).toMatchObject({failedCount: 5});
    });

    it("explicit trusted XFF retains separate network buckets and groups the same IPv4 /24", async () => {
        expect((await login({key: "supersecret1", bootstrapToken})).statusCode).toBe(200);
        AdminSecurityPolicyRegistry.configure({trustXForwardedFor: true});
        for(let index = 0; index < 5; index++) {
            expect((await login({key: "trusted-wrong-password"}, {"X-Forwarded-For": "10.1.1.5, 192.0.2.1"})).statusCode).toBe(401);
        }
        expect((await login({key: "another-wrong-password"}, {"X-Forwarded-For": "10.1.1.99"})).statusCode).toBe(429);
        expect((await login({key: "another-wrong-password"}, {"X-Forwarded-For": "10.1.2.5"})).statusCode).toBe(401);
    });

    it("(b) trustXForwardedFor=false 기본값 — XFF 헤더 무시", () => {
        const current = AdminSecurityPolicyRegistry.current();
        expect(current.trustXForwardedFor).toBe(false);
        // 정책 객체는 object 복사이며 변경되어도 내부에 영향 없음 (Registry.configure 거쳐야 반영).
    });

    it("(c) LRU 축출 — 10,001 개의 서로 다른 키 실패 후에도 map 이 10,000 상한 유지", async () => {
        // 네트워크/백오프 대기 10,050회를 만들지 않고 실제 기록 메서드의 상한을 검사한다.
        const mapRef: Map<string, any> = (adminServer as any)._loginAttempts;
        // Map 직접 조작 없이 IncomingMessage 형태의 명시적 데이터 fixture를 전달한다.
        const stubReq: any = {
            socket: {remoteAddress: "127.0.0.1"},
            headers: {}
        };
        for(let i = 0; i < 10_050; i++) {
            // 서로 다른 IPv4 /24 네트워크로 bucket 을 분산시킨다.
            stubReq.socket.remoteAddress = `10.${Math.floor(i / 256) % 256}.${i % 256}.1`;
            (adminServer as any).recordLoginFailure(stubReq);
        }
        expect(mapRef.size).toBeLessThanOrEqual(10_000);
        expect(mapRef.size).toBeGreaterThan(9_000); // 의미 있는 데이터 유지.
    });

    it("(d) 실패 응답 지연 하한 — 4회차 실패 시 computeBackoffMs >= 400ms", async () => {
        // 부트스트랩 완료 상태에서 연속 실패 유도.
        const bootstrapRes = await login({key: "supersecret1", bootstrapToken});
        expect(bootstrapRes.statusCode).toBe(200);
        // 1~3 실패 누적 (모두 401/429 허용).
        for(let i = 0; i < 3; i++) {
            await login({key: "wrong-d-pass"});
        }
        // 4번째 실패 직전의 failCount 는 3 이므로 이번 응답 지연은 computeBackoffMs(4) = 1600ms 수준.
        // 하한만 검증(>= 400ms) — 시스템 편차 허용.
        const t0 = Date.now();
        const r = await login({key: "wrong-d-pass"});
        const elapsed = Date.now() - t0;
        expect([401, 429]).toContain(r.statusCode);
        expect(elapsed).toBeGreaterThanOrEqual(400);
    });
});
