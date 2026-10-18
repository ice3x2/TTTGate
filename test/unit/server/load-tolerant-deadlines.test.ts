import EndPointClientPool from "../../../src/client/EndPointClientPool";
import {EXTERNAL_TLS_HANDSHAKE_TIMEOUT_MS} from "../../../src/server/ExternalPortServerPool";
import {DEFAULT_TUNNEL_HANDSHAKE_POLICY} from "../../../src/server/TunnelHandshakePolicy";

// #181 — 운영 서버는 0.5코어·512MB(스왑 4GB) 수준이다. 스왑 멈춤이 몇 초씩 걸려도 정상 연결이 기한에 잘리지 않게
// 기본 기한에 여유를 둔다. 미인증 연결의 개수 상한(#157)은 그대로라 기한을 늘려도 슬롯 점유의 상한은 같다.
describe("load-tolerant default deadlines (#181)", () => {
    it("gives unauthenticated tunnel handshakes (TLS and protocol) at least 15 seconds", () => {
        expect(DEFAULT_TUNNEL_HANDSHAKE_POLICY.timeoutMs).toBeGreaterThanOrEqual(15_000);
    });

    it("gives external TLS handshakes at least 20 seconds", () => {
        expect(EXTERNAL_TLS_HANDSHAKE_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000);
    });

    it("waits at least 60 seconds for a session to open, and the client gives up on the endpoint first", () => {
        expect(DEFAULT_TUNNEL_HANDSHAKE_POLICY.pendingSessionOpenTimeoutMs).toBeGreaterThanOrEqual(60_000);
        expect(EndPointClientPool.connectTimeoutMs).toBeGreaterThanOrEqual(30_000);
        // 클라이언트가 먼저 실패를 알려야 서버가 이유 없이 세션을 끊지 않는다(#179). 여유는 10초 이상.
        expect(DEFAULT_TUNNEL_HANDSHAKE_POLICY.pendingSessionOpenTimeoutMs - EndPointClientPool.connectTimeoutMs).toBeGreaterThanOrEqual(10_000);
    });
});
