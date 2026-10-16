import {AuditRateGate} from "../../../../src/server/security/AuditRateGate";

// U5-08 / #123 — 키별 1분 1회 통과 게이트. 시계는 인자로 받는다.

describe("AuditRateGate", () => {
    const feed = (gate: AuditRateGate): boolean[] =>
        [gate.allow("k", 0), gate.allow("k", 59_999), gate.allow("k", 60_000), gate.allow("j", 1)];

    it("마지막 통과로부터 60초가 지나야 다시 통과한다", () => {
        const gate = new AuditRateGate();
        expect(feed(gate)).toEqual([true, false, true, true]);
        expect(gate.size()).toBe(2);
    });

    it("prune 은 마지막 통과가 now - interval 이전인 키만 지운다", () => {
        const gate = new AuditRateGate();
        feed(gate);
        gate.prune(61_000);
        expect(gate.size()).toBe(1);
        // 'k' 는 60,000 에 통과했으므로 남아 있고 아직 막혀 있다.
        expect(gate.allow("k", 61_000)).toBe(false);
        gate.prune(120_000);
        expect(gate.size()).toBe(0);
        expect(gate.allow("k", 120_000)).toBe(true);
    });

    it("간격을 바꿀 수 있다", () => {
        const gate = new AuditRateGate(1_000);
        expect([gate.allow("k", 0), gate.allow("k", 999), gate.allow("k", 1_000)]).toEqual([true, false, true]);
    });
});
