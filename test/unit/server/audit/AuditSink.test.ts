import {AuditEvent, AuditSink, AuditSinkRegistry, LoggerAuditSink} from "../../../../src/server/audit/AuditSink";

/** 레지스트리는 전역이므로 케이스마다 되돌린다. */
afterEach(() => {
    AuditSinkRegistry.reset();
});

const eventOf = (detail?: Record<string, unknown>): AuditEvent => ({
    at: 1_757_548_800_000,
    actor: {userId: "u_1", username: "admin", role: "superuser"},
    type: "temp_password_issued",
    target: {kind: "user", id: "u_1"},
    outcome: "success",
    summary: "temp_password_issued u_1",
    detail
});

describe("AuditSinkRegistry", () => {
    it("기본 싱크는 LoggerAuditSink 이고 reserve() 가 항상 true 다", () => {
        const sink = AuditSinkRegistry.current();
        expect(sink).toBeInstanceOf(LoggerAuditSink);
        expect(sink.reserve()).toBe(true);
    });

    it("set() 한 싱크가 current() 로 돌아오고 reset() 이 LoggerAuditSink 로 되돌린다", () => {
        const stub: AuditSink = {reserve: () => true, record: () => Promise.resolve()};
        AuditSinkRegistry.set(stub);
        expect(AuditSinkRegistry.current()).toBe(stub);

        AuditSinkRegistry.reset();
        expect(AuditSinkRegistry.current()).not.toBe(stub);
        expect(AuditSinkRegistry.current()).toBeInstanceOf(LoggerAuditSink);
    });
});

describe("LoggerAuditSink", () => {
    it("기록한 줄에서 비밀값을 지우고 type·outcome 은 그대로 남긴다", async () => {
        const lines: string[] = [];
        const sink = new LoggerAuditSink((line) => lines.push(line));

        await sink.record(eventOf({temporaryPassword: "temp-plaintext-secret", sessionToken: "session-token-secret"}));

        expect(lines).toHaveLength(1);
        const line = lines[0];
        expect(line).not.toContain("temp-plaintext-secret");
        expect(line).not.toContain("session-token-secret");
        expect(line).toContain("[REDACTED]");

        const recorded = JSON.parse(line.slice(line.indexOf("{")));
        expect(recorded.type).toBe("temp_password_issued");
        expect(recorded.outcome).toBe("success");
        expect(recorded.target).toEqual({kind: "user", id: "u_1"});
    });
});
