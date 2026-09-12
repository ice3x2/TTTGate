import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import LoggerFactory from "../../../../src/util/logger/LoggerFactory";

describe("AdmissionController.snapshot", () => {
    beforeEach(() => {
        AdmissionController.resetForTest();
    });

    afterEach(() => {
        AdmissionController.resetForTest();
    });

    it("tallies per-port rejections and banned addresses, and keeps the admin scope separate", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({
            forwardPort: 1,
            rateLimit: {enabled: true, windowMs: 1000, maxConnections: 1, banMs: 1000}
        });

        const scope = {kind: "tunnel", port: 1, protocol: "tcp"} as const;
        controller.admit(scope, "1.1.1.1", 0);
        controller.admit(scope, "1.1.1.1", 1);
        controller.admit(scope, "1.1.1.1", 2);

        expect(controller.snapshot()).toEqual({
            ports: {"1": {rejectedBans: 1, rejectedExceeded: 1, rejectedGeo: 0, bannedIps: 1}},
            admin: {rejectedGeo: 0}
        });
    });

    it("records one denial bucket per reason without logging each rejected connection", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({
            forwardPort: 1,
            rateLimit: {enabled: true, windowMs: 1000, maxConnections: 1, banMs: 1000}
        });

        const scope = {kind: "tunnel", port: 1, protocol: "tcp"} as const;
        controller.admit(scope, "1.1.1.1", 0);
        controller.admit(scope, "1.1.1.1", 1);
        controller.admit(scope, "1.1.1.1", 2);

        expect(controller.denialLog.pending()).toBe(2);
        // 두 버킷의 창은 거절이 일어난 시각(now=1 의 창 초과, now=2 의 차단)에 열린다.
        // flushDue 는 windowStart + windowMs <= now 인 버킷만 내보내므로 60_000 에는 아직 하나도 만기되지 않는다.
        expect(controller.denialLog.flushDue(60_000)).toBe(0);
        expect(controller.denialLog.flushDue(60_002)).toBe(2);
        expect(controller.denialLog.pending()).toBe(0);
    });

    // 거절 지점 세 곳 중 3 단계(geo)를 덮는 케이스. 2 단계 차단과 4 단계 창 초과는 위 두 케이스가 덮는다.
    it("records a geo denial on the admin scope, so the aggregated line names port=admin", () => {
        const controller = AdmissionController.instance;
        controller.configureGeo({mode: "deny", countries: [], applyToAdmin: true, unknownPolicy: "deny"});

        const decision = controller.admit({kind: "admin"}, "127.0.0.1", 0);
        expect(decision).toMatchObject({allowed: false, reason: "geo-deny"});
        expect(controller.denialLog.pending()).toBe(1);

        // 실제 sink 는 로거로 나가므로, 집계된 줄을 읽으려면 그 로거의 warn 을 가로챈다.
        const lines: string[] = [];
        const warn = jest.spyOn(LoggerFactory.getLogger("server", "Admission"), "warn")
            .mockImplementation((message: string) => {
                lines.push(message);
            });
        try {
            expect(controller.denialLog.flushAll(0)).toBe(1);
        } finally {
            warn.mockRestore();
        }

        expect(lines).toEqual(["admission denied port=admin reason=geo-deny count=1 (last 60s)"]);
        expect(controller.denialLog.pending()).toBe(0);
    });

    it("drops a released tunnel from the snapshot, leaving an empty ports object", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({
            forwardPort: 1,
            rateLimit: {enabled: true, windowMs: 1000, maxConnections: 1, banMs: 1000}
        });
        controller.admit({kind: "tunnel", port: 1, protocol: "tcp"}, "1.1.1.1", 0);

        controller.releaseTunnel(1);

        const snapshot = controller.snapshot();
        expect(Object.keys(snapshot.ports)).toHaveLength(0);
        expect(snapshot).toEqual({ports: {}, admin: {rejectedGeo: 0}});
    });
});
