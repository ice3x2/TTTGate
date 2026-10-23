import {DEFAULT_HEARTBEAT_POLICY, HEARTBEAT_CAPABILITY, resolveHeartbeatPolicy} from "../../../src/commons/Heartbeat";
import {DEFAULT_PROTOCOL_V2_CAPABILITIES} from "../../../src/commons/ProtocolV2";

// #230 REQ-3·REQ-5
describe("heartbeat policy", () => {
    test("defaults are a 10 s ping and a 30 s silence limit, and protocol v2 advertises the capability", () => {
        expect(DEFAULT_HEARTBEAT_POLICY).toEqual({intervalMs: 10_000, timeoutMs: 30_000});
        expect(resolveHeartbeatPolicy({})).toEqual(DEFAULT_HEARTBEAT_POLICY);
        expect(DEFAULT_PROTOCOL_V2_CAPABILITIES).toContain(HEARTBEAT_CAPABILITY);
    });

    test("tests can shorten both values through the environment", () => {
        expect(resolveHeartbeatPolicy({TTTGATE_HEARTBEAT_INTERVAL_MS: "200", TTTGATE_HEARTBEAT_TIMEOUT_MS: "1000"}))
            .toEqual({intervalMs: 200, timeoutMs: 1000});
    });

    test.each([
        [{TTTGATE_HEARTBEAT_INTERVAL_MS: "abc"}],
        [{TTTGATE_HEARTBEAT_INTERVAL_MS: "10"}],
        [{TTTGATE_HEARTBEAT_INTERVAL_MS: "500", TTTGATE_HEARTBEAT_TIMEOUT_MS: "400"}],
        [{TTTGATE_HEARTBEAT_TIMEOUT_MS: "-5"}]
    ])("an invalid or inconsistent value %j falls back to the defaults", (env) => {
        expect(resolveHeartbeatPolicy(env)).toEqual(DEFAULT_HEARTBEAT_POLICY);
    });
});
