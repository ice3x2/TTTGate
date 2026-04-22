/**
 * P5-T5 / REQ-16 — SessionStore.isSessionValid 비동기 안전성 + Cookie 파싱 방어.
 *
 * Mock 금지: 실제 SessionStore 인스턴스 + 실제 Map 상태를 사용한다.
 *
 * 4 케이스:
 *  (1) forEach → for...of 전환 검증: isSessionValid 동작 유지 (유효 세션 true, 만료 세션 false + Map 축출).
 *  (2) 만료된 세션은 Map 에서 삭제되어 후속 조회 false.
 *  (3) Cookie 파싱: `sid=abc=xy` 에서 `abc=xy` 정확히 추출.
 *  (4) Cookie 파싱: 여러 쿠키 중 첫 `=` 기준으로만 분리 — 값 내부 `=` 보존.
 */
import SessionStore from "../../../../src/server/admin/SessionStore";
import {ClockRngProvider} from "../../../../src/util/ClockRng";
import {createFakeClockRng, FakeClockRng} from "../../../helpers/clockRng";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../../helpers/runtime";

describe("REQ-16 SessionStore isSessionValid + Cookie parse", () => {
    let testRoot: TestRoot;
    let fakeClock: FakeClockRng;

    beforeEach(async () => {
        testRoot = await createTestRoot("req-16-session");
        applyTestRoot(testRoot.rootDir);
        fakeClock = createFakeClockRng(1_700_000_000_000, [0.1]);
        ClockRngProvider.configure(fakeClock);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("(1) isSessionValid — 유효 세션 true, for...of 반복으로 다수 키 처리", async () => {
        const store = SessionStore.instance;
        const s1 = await store.newSession();
        const s2 = await store.newSession();
        expect(s1).not.toBe(s2);
        // 두 세션 모두 유효 → true.
        expect(await store.isSessionValid([s1, s2])).toBe(true);
    });

    it("(2) isSessionValid — 만료 세션은 false + Map 에서 제거", async () => {
        const store = SessionStore.instance;
        const sk = await store.newSession();
        // 12시간 + 1ms 진행 → 만료.
        fakeClock.advance(12 * 60 * 60 * 1000 + 1);
        expect(await store.isSessionValid([sk])).toBe(false);
        // 제거된 뒤 재검증도 false (살아남아서는 안 됨).
        expect(await store.isSessionValid([sk])).toBe(false);
    });

    it("(3) parseCookieHeader — sid=abc=xy 에서 값 `abc=xy` 정확히 추출", () => {
        const cookies = SessionStore.parseCookieHeader("sid=abc=xy");
        expect(cookies.get("sid")).toBe("abc=xy");
    });

    it("(4) parseCookieHeader — 여러 쿠키 + 값 내부 '=' 보존", () => {
        const cookies = SessionStore.parseCookieHeader("sessionKey=deadbeef; csrfToken=a==b; other=plain");
        expect(cookies.get("sessionKey")).toBe("deadbeef");
        expect(cookies.get("csrfToken")).toBe("a==b");
        expect(cookies.get("other")).toBe("plain");
        // 빈 문자열/누락된 '=' 방어.
        expect(SessionStore.parseCookieHeader(undefined).size).toBe(0);
        expect(SessionStore.parseCookieHeader("   ").size).toBe(0);
        expect(SessionStore.parseCookieHeader("nopair; =emptyname=x").size).toBe(0);
    });
});
