import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import {BlocklistEntry, DEFAULT_GEO_CONFIG} from "../../../../src/types/TunnelingOption";

const entryOf = (address: string, port: number | null = null): BlocklistEntry =>
    ({address, port, note: "", createdAt: 1, createdBy: "admin"});

const tunnel = (port: number) => ({kind: "tunnel", port, protocol: "tcp"}) as const;

describe("AdmissionController 차단 목록 (#286)", () => {
    beforeEach(() => {
        AdmissionController.resetForTest();
    });

    afterAll(() => {
        AdmissionController.resetForTest();
    });

    it("차단 목록의 주소는 ip-blocklist 로 거절하고 다른 주소는 들인다", () => {
        const controller = AdmissionController.instance;
        controller.configureConnectionSecurity({geo: {...DEFAULT_GEO_CONFIG}, blocklist: [entryOf("203.0.113.7")]});
        expect(controller.admit(tunnel(1111), "203.0.113.7", 0)).toEqual({allowed: false, reason: "ip-blocklist"});
        expect(controller.admit(tunnel(1111), "::ffff:203.0.113.7", 0)).toEqual({allowed: false, reason: "ip-blocklist"});
        expect(controller.admit(tunnel(1111), "203.0.113.8", 0)).toEqual({allowed: true});
    });

    it("레이트 리밋과 국가 조회보다 먼저 판정해 그 카운터를 늘리지 않는다", () => {
        const controller = AdmissionController.instance;
        controller.configureConnectionSecurity({
            geo: {mode: "deny", countries: ["KP"], applyToAdmin: false, unknownPolicy: "allow"},
            blocklist: [entryOf("8.8.8.8")]
        });
        controller.configureTunnel({forwardPort: 1111, rateLimit: {enabled: true, windowMs: 60_000, maxConnections: 1, banMs: 60_000}});
        for(let i = 0; i < 5; i++) {
            expect(controller.admit(tunnel(1111), "8.8.8.8", i)).toMatchObject({reason: "ip-blocklist"});
        }
        expect(controller.rateLimiter.trackedIps(1111)).toBe(0);
        expect(controller.rateLimiter.bans(0)).toEqual([]);
        expect(controller.denials(1111)).toEqual({geo: 0, rateLimit: 0});
        expect(controller.geo.stats().lookups).toBe(0);
    });

    // 레이트 리밋 차단 판정은 연결마다 한 번만 한다(차단 목록 다음, 국가 필터 앞).
    it("레이트 리밋 차단 판정을 연결마다 한 번만 한다", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({forwardPort: 1111, rateLimit: {enabled: true, windowMs: 60_000, maxConnections: 5, banMs: 60_000}});
        const banned = jest.spyOn(controller.rateLimiter, "banned");
        expect(controller.admit(tunnel(1111), "198.51.100.5", 0)).toEqual({allowed: true});
        expect(banned).toHaveBeenCalledTimes(1);
        banned.mockRestore();
    });

    it("거절을 거절 집계 로그에 남긴다", () => {
        const controller = AdmissionController.instance;
        controller.configureConnectionSecurity({geo: {...DEFAULT_GEO_CONFIG}, blocklist: [entryOf("203.0.113.7")]});
        controller.admit(tunnel(1111), "203.0.113.7", 0);
        expect(controller.denialLog.pending()).toBe(1);
    });

    it("관리 화면 연결에는 적용하지 않는다 (REQ-3 AC-3)", () => {
        const controller = AdmissionController.instance;
        controller.configureConnectionSecurity({geo: {...DEFAULT_GEO_CONFIG}, blocklist: [entryOf("203.0.113.7")]});
        expect(controller.admit({kind: "admin"}, "203.0.113.7", 0)).toEqual({allowed: true});
    });

    it("터널을 다시 구성하거나 풀어도 차단은 남는다 (REQ-2 AC-2)", () => {
        const controller = AdmissionController.instance;
        controller.configureConnectionSecurity({geo: {...DEFAULT_GEO_CONFIG}, blocklist: [entryOf("203.0.113.7")]});
        controller.configureTunnel({forwardPort: 1111, rateLimit: {enabled: true, windowMs: 1000, maxConnections: 5, banMs: 1000}});
        controller.releaseTunnel(1111);
        controller.configureTunnel({forwardPort: 1111, rateLimit: {enabled: true, windowMs: 1000, maxConnections: 5, banMs: 1000}});
        expect(controller.admit(tunnel(1111), "203.0.113.7", 0)).toMatchObject({reason: "ip-blocklist"});
    });

    it("blocklist 가 없는 설정이면 차단 목록을 비운다", () => {
        const controller = AdmissionController.instance;
        controller.configureConnectionSecurity({geo: {...DEFAULT_GEO_CONFIG}, blocklist: [entryOf("203.0.113.7")]});
        controller.configureConnectionSecurity({geo: {...DEFAULT_GEO_CONFIG}});
        expect(controller.admit(tunnel(1111), "203.0.113.7", 0)).toEqual({allowed: true});
    });

    it("configureConnectionSecurity 는 국가 필터도 함께 적용한다", () => {
        const controller = AdmissionController.instance;
        controller.configureConnectionSecurity({geo: {mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "deny"}, blocklist: []});
        expect(controller.admit({kind: "admin"}, "127.0.0.1", 0)).toEqual({allowed: false, reason: "geo-deny"});
    });
});
