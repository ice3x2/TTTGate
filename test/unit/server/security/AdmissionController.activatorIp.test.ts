import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import {ConcurrencyLimiter} from "../../../../src/server/security/ConcurrencyLimiter";

// 이슈 348 — 터널을 켠 사람의 IP 만 받는 판정(activator-ip). 판정 순서와 주소를 모를 때의 거부, 거부 기록을 본다.
const TUNNEL_1 = {kind: "tunnel", port: 1, protocol: "tcp"} as const;
const TUNNEL_2 = {kind: "tunnel", port: 2, protocol: "http"} as const;
const RATE_LIMIT = {enabled: true, windowMs: 60_000, maxConnections: 1, banMs: 60_000};

describe("AdmissionController activator-ip (이슈 348)", () => {
    beforeEach(() => AdmissionController.resetForTest());
    afterEach(() => AdmissionController.resetForTest());

    /** 포트 1 만 제한이 켜져 있고 허용 IP 는 203.0.113.5 다. 포트 2 는 제한이 꺼져 있다. */
    const restrictPort1 = (allowed: string[] = ["203.0.113.5"]) =>
        AdmissionController.instance.attachActivatorIps((port) => port === 1 ? new Set(allowed) : undefined);

    it("허용 IP 는 받고 다른 IP 는 사유 activator-ip 로 거부한다 (AC-2·FR-8)", () => {
        restrictPort1();
        const controller = AdmissionController.instance;
        expect(controller.admit(TUNNEL_1, "203.0.113.5", 0)).toEqual({allowed: true});
        expect(controller.admit(TUNNEL_1, "::ffff:203.0.113.5", 0)).toEqual({allowed: true});
        expect(controller.admit(TUNNEL_1, "198.51.100.1", 0)).toEqual({allowed: false, reason: "activator-ip"});
    });

    it("제한이 꺼진 터널과 관리 화면에는 적용하지 않는다 (AC-6)", () => {
        restrictPort1();
        const controller = AdmissionController.instance;
        expect(controller.admit(TUNNEL_2, "198.51.100.1", 0)).toEqual({allowed: true});
        expect(controller.admit({kind: "admin"}, "198.51.100.1", 0)).toEqual({allowed: true});
    });

    it("허용 IP 목록이 비어 있으면 모두 거부한다 (FR-9)", () => {
        restrictPort1([]);
        expect(AdmissionController.instance.admit(TUNNEL_1, "203.0.113.5", 0)).toMatchObject({reason: "activator-ip"});
    });

    it("연결 IP 를 모르면 제한이 켜진 터널만 거부한다 (FR-8)", () => {
        restrictPort1();
        const controller = AdmissionController.instance;
        expect(controller.admit(TUNNEL_1, undefined, 0)).toMatchObject({reason: "activator-ip"});
        expect(controller.admitBeforeHandshake(TUNNEL_1, undefined, 0)).toMatchObject({reason: "activator-ip"});
        expect(controller.admit(TUNNEL_2, undefined, 0)).toEqual({allowed: true});
        expect(controller.admitBeforeHandshake(TUNNEL_2, undefined, 0)).toEqual({allowed: true});
    });

    it("핸드셰이크 전 판정에서 거부한다 (AC-2b)", () => {
        restrictPort1();
        const controller = AdmissionController.instance;
        expect(controller.admitBeforeHandshake(TUNNEL_1, "198.51.100.1", 0)).toMatchObject({reason: "activator-ip"});
        expect(controller.admitBeforeHandshake(TUNNEL_1, "203.0.113.5", 0)).toEqual({allowed: true});
    });

    it("차단 목록이 먼저이고, 그 다음이 레이트 리밋 차단 중이다 (FR-11)", () => {
        restrictPort1();
        const controller = AdmissionController.instance;
        controller.blocklist.configure([{address: "198.51.100.9", port: null, note: "", createdAt: 0, createdBy: ""}]);
        expect(controller.admit(TUNNEL_1, "198.51.100.9", 0)).toMatchObject({reason: "ip-blocklist"});
        // 허용 IP 가 레이트 리밋으로 차단되면 차단 사유가 먼저다.
        controller.configureTunnel({forwardPort: 1, rateLimit: RATE_LIMIT});
        controller.admit(TUNNEL_1, "203.0.113.5", 1);
        controller.admit(TUNNEL_1, "203.0.113.5", 2);
        expect(controller.admit(TUNNEL_1, "203.0.113.5", 3)).toMatchObject({reason: "rate-limit-ban"});
    });

    it("허용되지 않은 IP 는 국가 조회와 레이트 리밋 계수, 동시 연결 상한까지 가지 않는다 (AC-16·FR-11)", () => {
        restrictPort1();
        const controller = AdmissionController.instance;
        controller.configureTunnel({forwardPort: 1, rateLimit: RATE_LIMIT});
        controller.configureGeo({mode: "deny", countries: [], applyToAdmin: false, unknownPolicy: "deny"});
        const decide = jest.fn(() => ({decision: {allowed: false, reason: "concurrency-limit"}}));
        controller.attachConcurrency({decide} as unknown as ConcurrencyLimiter);
        const lookups = controller.geo.stats().lookups;
        for(let now = 0; now < 3; now++) {
            expect(controller.admit(TUNNEL_1, "127.0.0.2", now)).toMatchObject({reason: "activator-ip"});
        }
        expect(controller.geo.stats().lookups).toBe(lookups);
        expect(controller.rateLimiter.stats(1).bannedIps).toBe(0);
        expect(decide).not.toHaveBeenCalled();
    });

    it("거부는 거부 집계·최근 거부·포트별 통계(rejectedActivatorIp)에 남는다 (FR-10)", () => {
        restrictPort1();
        const controller = AdmissionController.instance;
        controller.admit(TUNNEL_1, "198.51.100.1", 5);
        controller.admitBeforeHandshake(TUNNEL_1, undefined, 6);
        expect(controller.snapshot().ports["1"]).toMatchObject({rejectedActivatorIp: 2});
        expect(controller.recentDenials()).toEqual([
            {at: 6, ip: "unknown", scope: 1, reason: "activator-ip"},
            {at: 5, ip: "198.51.100.1", scope: 1, reason: "activator-ip"}
        ]);
        expect(controller.denialLog.pending()).toBe(1);
    });

    it("공급 함수를 떼면 제한하지 않는다", () => {
        restrictPort1();
        AdmissionController.instance.attachActivatorIps(null);
        expect(AdmissionController.instance.admit(TUNNEL_1, "198.51.100.1", 0)).toEqual({allowed: true});
    });
});
