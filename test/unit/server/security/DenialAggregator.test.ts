import {AdmissionScope} from "../../../../src/server/security/AdmissionPolicy";
import {DenialAggregator} from "../../../../src/server/security/DenialAggregator";

const TUNNEL_20001: AdmissionScope = {kind: "tunnel", port: 20001, protocol: "tcp"};
const ADMIN: AdmissionScope = {kind: "admin"};

describe("DenialAggregator", () => {
    it("holds a bucket until the window closes, then emits a single tallied line", () => {
        const lines: string[] = [];
        const aggregator = new DenialAggregator(line => lines.push(line), 60000);

        for(let now = 0; now <= 1531; now++) {
            aggregator.record(TUNNEL_20001, "rate-limit-ban", now);
        }

        expect(aggregator.flushDue(59_999)).toBe(0);
        expect(lines).toEqual([]);

        expect(aggregator.flushDue(60_000)).toBe(1);
        expect(lines).toEqual(["admission denied port=20001 reason=rate-limit-ban count=1532 (last 60s)"]);
    });

    it("keeps one bucket per (scope, reason) pair and labels the admin scope as port=admin", () => {
        const lines: string[] = [];
        const aggregator = new DenialAggregator(line => lines.push(line), 60000);

        aggregator.record(TUNNEL_20001, "rate-limit-exceeded", 0);
        aggregator.record(ADMIN, "geo-deny", 0);

        expect(aggregator.flushAll(0)).toBe(2);
        expect(lines.filter(line => line === "admission denied port=20001 reason=rate-limit-exceeded count=1 (last 60s)")).toHaveLength(1);
        expect(lines.filter(line => line === "admission denied port=admin reason=geo-deny count=1 (last 60s)")).toHaveLength(1);
        expect(aggregator.pending()).toBe(0);
    });

    it("starts a fresh window when the same key is recorded again after a flush", () => {
        const lines: string[] = [];
        const aggregator = new DenialAggregator(line => lines.push(line), 60000);

        aggregator.record(TUNNEL_20001, "rate-limit-ban", 0);
        expect(aggregator.flushDue(60_000)).toBe(1);

        aggregator.record(TUNNEL_20001, "rate-limit-ban", 60_000);
        expect(aggregator.pending()).toBe(1);
        expect(aggregator.flushDue(60_000 + 59_999)).toBe(0);
        expect(lines).toHaveLength(1);
    });

    it("drops the buckets before calling the sink, so a throwing sink neither escapes nor leaves work behind", () => {
        const aggregator = new DenialAggregator(() => {
            throw new Error("sink is down");
        }, 60000);

        aggregator.record(TUNNEL_20001, "rate-limit-ban", 0);
        aggregator.record(ADMIN, "geo-deny", 0);

        expect(() => aggregator.flushAll(0)).not.toThrow();
        expect(aggregator.pending()).toBe(0);
    });
});
