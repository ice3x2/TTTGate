import {createLoginFailureAuditor, loginFailureUsername} from "../../../../src/server/admin/loginFailureAudit";

// #139 — 로그인 실패 감사가 인증 없이 감사 파일·큐를 채우지 못하게 한다.
describe("loginFailureAudit", () => {
    const NOW = 1_757_548_800_000;

    it("형식이 맞는 username 만 원문으로 남기고, 아니면 고정값과 길이만 남긴다", () => {
        expect(loginFailureUsername("Alice")).toEqual({username: "alice"});
        expect(loginFailureUsername(undefined)).toEqual({username: "(missing)"});
        expect(loginFailureUsername("pass word!")).toEqual({username: "(invalid)", usernameLength: 10});
        expect(loginFailureUsername(12345)).toEqual({username: "(invalid)"});
        expect(loginFailureUsername({nested: "x".repeat(1000)})).toEqual({username: "(invalid)"});
    });

    it("차단 중 감사는 원본 IP 가 아니라 차단 버킷으로 묶인다(같은 /64 의 다른 주소)", () => {
        const audit = createLoginFailureAuditor();
        const events = Array.from({length: 20}, (_, i) =>
            audit({username: "admin"}, `2001:db8:0:1::${(i + 1).toString(16)}`, "v6:2001:db8:0:1::/64", 429, NOW + i));
        expect(events.filter((event) => event !== undefined)).toHaveLength(1);
        expect(events[0]!.detail).toMatchObject({blocked: true, username: "admin"});
        // 1분이 지나면 다시 한 건 남는다.
        expect(audit({username: "admin"}, "2001:db8:0:1::99", "v6:2001:db8:0:1::/64", 429, NOW + 60_000)).toBeDefined();
    });

    it("버킷 수가 상한을 넘으면 넘친 차단 요청을 한 키로 묶는다", () => {
        const audit = createLoginFailureAuditor({maxKeys: 3});
        const events = Array.from({length: 50}, (_, i) => audit({username: "admin"}, `10.0.${i}.1`, `v4:10.0.${i}.0/24`, 429, NOW + i));
        expect(events.filter((event) => event !== undefined)).toHaveLength(4);
    });

    // #251 — 동시 처리 상한 429 는 차단과 다르다. blocked 로 적지 않고, 차단 감사의 1분 칸도 먼저 차지하지 않는다.
    it("동시 처리 상한 429 는 reason 으로 구분하고 차단 감사 칸을 따로 쓴다", () => {
        const audit = createLoginFailureAuditor();
        const limited = audit({username: "admin"}, "10.0.0.1", "v4:10.0.0.0/24", 429, NOW, "concurrency_limit");
        expect(limited!.detail).toEqual({username: "admin", reason: "concurrency_limit"});
        expect(audit({username: "admin"}, "10.0.0.1", "v4:10.0.0.0/24", 429, NOW + 1, "concurrency_limit")).toBeUndefined();
        const blocked = audit({username: "admin"}, "10.0.0.1", "v4:10.0.0.0/24", 429, NOW + 2);
        expect(blocked!.detail).toEqual({username: "admin", blocked: true});
    });

    // #265 — 본문을 읽기 전에 거절한 요청(body undefined)은 빠진 username 과 구분해 '(unread)' 로 남긴다.
    it("본문을 읽기 전에 거절한 요청은 username 을 (unread) 로 남긴다", () => {
        const audit = createLoginFailureAuditor();
        expect(audit(undefined, "10.0.0.1", "v4:10.0.0.0/24", 429, NOW, "concurrency_limit")!.detail)
            .toEqual({username: "(unread)", reason: "concurrency_limit"});
        expect(audit(undefined, "10.0.0.2", "v4:10.0.1.0/24", 429, NOW)!.detail).toEqual({username: "(unread)", blocked: true});
        expect(audit({}, "10.0.0.3", "v4:10.0.2.0/24", 401, NOW)!.detail).toEqual({username: "(missing)"});
    });

    it("차단이 아닌 실패는 지금처럼 요청마다 남는다", () => {
        const audit = createLoginFailureAuditor();
        const events = Array.from({length: 3}, () => audit({username: "admin"}, "127.0.0.1", "v4:127.0.0.0/24", 401, NOW));
        expect(events.every((event) => event !== undefined && (event.detail as any).blocked === undefined)).toBe(true);
    });
});
