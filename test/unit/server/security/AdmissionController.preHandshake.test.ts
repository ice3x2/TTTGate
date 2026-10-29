import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import {DEFAULT_GEO_CONFIG} from "../../../../src/types/TunnelingOption";

// #287 — TLS 외부 포트가 핸드셰이크 전에 부르는 판정. 이미 거절하기로 정해진 주소(차단 목록, 레이트 리밋 차단 중)만 거절한다.
const tunnel = {kind: "tunnel", port: 1111, protocol: "https"} as const;

describe("AdmissionController.admitBeforeHandshake (#287)", () => {
    beforeEach(() => {
        AdmissionController.resetForTest();
    });

    afterAll(() => {
        AdmissionController.resetForTest();
    });

    it("차단 목록의 주소는 ip-blocklist 로 거절하고 거절 집계에 남긴다 (REQ-1, REQ-4)", () => {
        const controller = AdmissionController.instance;
        controller.configureConnectionSecurity({geo: {...DEFAULT_GEO_CONFIG},
            blocklist: [{address: "203.0.113.7", port: null, note: "", createdAt: 1, createdBy: "admin"}]});
        expect(controller.admitBeforeHandshake(tunnel, "203.0.113.7", 0)).toEqual({allowed: false, reason: "ip-blocklist"});
        expect(controller.admitBeforeHandshake(tunnel, "::ffff:203.0.113.7", 0)).toEqual({allowed: false, reason: "ip-blocklist"});
        expect(controller.denialLog.pending()).toBe(1);
    });

    it("레이트 리밋으로 차단 중인 주소는 rate-limit-ban 으로 거절하고, 차단이 끝나면 들인다 (REQ-2)", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({forwardPort: 1111, rateLimit: {enabled: true, windowMs: 60_000, maxConnections: 1, banMs: 1_000}});
        controller.admit(tunnel, "198.51.100.5", 0);
        controller.admit(tunnel, "198.51.100.5", 1);
        const pending = controller.denialLog.pending();
        expect(controller.admitBeforeHandshake(tunnel, "198.51.100.5", 2)).toMatchObject({allowed: false, reason: "rate-limit-ban"});
        // rate-limit-ban 사유로 거절 집계에 한 줄이 더 생긴다(REQ-4).
        expect(controller.denialLog.pending()).toBe(pending + 1);
        expect(controller.denials(1111).rateLimit).toBe(2);
        expect(controller.admitBeforeHandshake(tunnel, "198.51.100.5", 5_000)).toEqual({allowed: true});
    });

    it("그 밖의 주소는 들이고, 레이트 리밋 계수와 국가 조회는 하지 않는다 (REQ-5)", () => {
        const controller = AdmissionController.instance;
        controller.configureConnectionSecurity({geo: {mode: "deny", countries: ["KP"], applyToAdmin: false, unknownPolicy: "allow"}, blocklist: []});
        controller.configureTunnel({forwardPort: 1111, rateLimit: {enabled: true, windowMs: 60_000, maxConnections: 1, banMs: 60_000}});
        for(let i = 0; i < 5; i++) {
            expect(controller.admitBeforeHandshake(tunnel, "8.8.8.8", i)).toEqual({allowed: true});
        }
        expect(controller.rateLimiter.trackedIps(1111)).toBe(0);
        expect(controller.geo.stats().lookups).toBe(0);
        expect(controller.denialLog.pending()).toBe(0);
    });

    it("주소를 모르면 들인다", () => {
        expect(AdmissionController.instance.admitBeforeHandshake(tunnel, undefined, 0)).toEqual({allowed: true});
    });
});
