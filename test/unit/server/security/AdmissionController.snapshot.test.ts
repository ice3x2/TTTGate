import {AdmissionController} from "../../../../src/server/security/AdmissionController";

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
