import {AdmissionController} from "../../../../src/server/security/AdmissionController";

describe("AdmissionController", () => {
    beforeEach(() => {
        AdmissionController.resetForTest();
    });

    it("admits when the remote address is undefined", () => {
        const decision = AdmissionController.instance.admit({kind: "tunnel", port: 1, protocol: "tcp"}, undefined, 0);
        expect(decision).toEqual({allowed: true});
    });

    it("admits admin scope traffic when no tunnel is configured", () => {
        const decision = AdmissionController.instance.admit({kind: "admin"}, "8.8.8.8", 0);
        expect(decision).toEqual({allowed: true});
    });

    it("rejects a tunnel once the configured rate limit is exceeded, then bans, and tallies denials", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({
            forwardPort: 1,
            rateLimit: {enabled: true, windowMs: 1000, maxConnections: 1, banMs: 1000}
        });

        const scope = {kind: "tunnel", port: 1, protocol: "tcp"} as const;
        expect(controller.admit(scope, "1.1.1.1", 0)).toEqual({allowed: true});
        expect(controller.admit(scope, "1.1.1.1", 1)).toMatchObject({reason: "rate-limit-exceeded"});
        expect(controller.admit(scope, "1.1.1.1", 2)).toMatchObject({reason: "rate-limit-ban"});

        expect(controller.denials(1)).toEqual({geo: 0, rateLimit: 2});
    });

    it("admits everything when rateLimit is disabled or absent", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({
            forwardPort: 1,
            rateLimit: {enabled: false, windowMs: 1000, maxConnections: 1, banMs: 1000}
        });

        const scope = {kind: "tunnel", port: 1, protocol: "tcp"} as const;
        for (let i = 0; i < 100; i++) {
            expect(controller.admit(scope, "1.1.1.1", i)).toEqual({allowed: true});
        }
    });

    it("resets denial counters when a tunnel is released", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({
            forwardPort: 1,
            rateLimit: {enabled: true, windowMs: 1000, maxConnections: 1, banMs: 1000}
        });

        const scope = {kind: "tunnel", port: 1, protocol: "tcp"} as const;
        controller.admit(scope, "1.1.1.1", 0);
        controller.admit(scope, "1.1.1.1", 1);

        controller.releaseTunnel(1);

        expect(controller.denials(1)).toEqual({geo: 0, rateLimit: 0});
    });

    it("treats an IPv4-mapped address and its plain IPv4 form as the same window", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({
            forwardPort: 1,
            rateLimit: {enabled: true, windowMs: 1000, maxConnections: 1, banMs: 1000}
        });

        const scope = {kind: "tunnel", port: 1, protocol: "tcp"} as const;
        expect(controller.admit(scope, "::ffff:9.9.9.9", 0)).toEqual({allowed: true});
        expect(controller.admit(scope, "9.9.9.9", 1)).toMatchObject({reason: "rate-limit-exceeded"});
    });

    it("does not change admission results merely by configuring a concurrency provider", () => {
        const controller = AdmissionController.instance;
        controller.configureTunnel({
            forwardPort: 1,
            rateLimit: {enabled: true, windowMs: 1000, maxConnections: 1, banMs: 1000}
        });
        controller.configureConcurrency(() => 0);

        const scope = {kind: "tunnel", port: 1, protocol: "tcp"} as const;
        expect(controller.admit(scope, "1.1.1.1", 0)).toEqual({allowed: true});
    });

    it("returns a fresh, unconfigured instance after resetForTest", () => {
        const before = AdmissionController.instance;
        before.configureTunnel({
            forwardPort: 1,
            rateLimit: {enabled: true, windowMs: 1000, maxConnections: 1, banMs: 1000}
        });

        AdmissionController.resetForTest();

        const after = AdmissionController.instance;
        expect(after).not.toBe(before);

        const scope = {kind: "tunnel", port: 1, protocol: "tcp"} as const;
        expect(after.admit(scope, "1.1.1.1", 0)).toEqual({allowed: true});
        expect(after.admit(scope, "1.1.1.1", 1)).toEqual({allowed: true});
    });
});
