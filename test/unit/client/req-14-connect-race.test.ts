/**
 * P6-T2 / REQ-14 — TunnelClient.connectDataHandler race 해소 검증.
 *
 * Mock 금지: 실 net.createServer + 즉시 accept. TunnelClient의 private 메서드에 직접 접근.
 *
 * 시나리오:
 *   - 가짜(실) 서버가 즉시 accept하여 Connected 이벤트가 SocketHandler.connect 호출과
 *     사실상 동기로 발화될 수 있는 조건을 만든다.
 *   - 100회 반복 connectDataHandler → Connected 직후 handler.handlerID/sessionID/bindingToken이
 *     100% 정의(undefined 없음)임을 검증한다.
 *
 * race 재현 시드: net.createServer가 127.0.0.1에서 listen 후 즉시 data를 받지 않고 accept만 하는 환경.
 */
import net from "net";
import {TunnelClient} from "../../../src/client/TunnelClient";
import {DataHandlerState, HandlerType, TunnelDataHandler} from "../../../src/types/TunnelHandler";

jest.setTimeout(30000);

const startAcceptServer = async (): Promise<{ port: number; close: () => Promise<void>; sockets: net.Socket[] }> => {
    const sockets: net.Socket[] = [];
    const server = net.createServer((socket) => {
        sockets.push(socket);
        // 즉시 accept. 데이터는 소비만(에러 방지).
        socket.on("data", () => { /* drain */ });
        socket.on("error", () => { /* noop */ });
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    return {
        port,
        sockets,
        async close() {
            for(const s of sockets) { try { s.destroy(); } catch { /* noop */ } }
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    };
};

describe("REQ-14 TunnelClient.connectDataHandler race", () => {
    it("handler.handlerID/sessionID/bindingToken 100/100 defined on immediate accept", async () => {
        const server = await startAcceptServer();
        try {
            const client = TunnelClient.create({
                key: "k",
                host: "127.0.0.1",
                port: server.port,
                tls: false,
                name: "race",
                globalMemCacheLimit: 128,
                keepAlive: 0
            });

            // private 멤버 직접 접근(race 재현 단위 테스트 한정). 타입 안정을 위해 any 캐스팅.
            const priv = client as any;
            // DataStatePacket.toBuffer는 UInt32BE이므로 ctrlID를 양수로 세팅.
            priv._id = 1;

            // Ctrl handshake 없이 connectDataHandler만 100회 호출. Connected 콜백 경로에서
            // handlerID/sessionID/bindingToken 주입을 검증.
            const HANDLERS: TunnelDataHandler[] = [];
            // Monkey-patch _activatedSessionDataHandlerMap.set을 가로채서 Connected 직후 상태를 즉시 캡처.
            const origMap: Map<number, TunnelDataHandler> = priv._activatedSessionDataHandlerMap;
            const origSet = origMap.set.bind(origMap);
            (origMap as any).set = function(id: number, h: TunnelDataHandler) {
                HANDLERS.push({
                    handlerID: h.handlerID,
                    sessionID: h.sessionID,
                    bindingToken: h.bindingToken,
                    handlerType: h.handlerType,
                    dataHandlerState: h.dataHandlerState
                } as any);
                return origSet(id, h);
            };

            const N = 100;
            for(let i = 1; i <= N; i++) {
                priv.connectDataHandler(i * 10 + 1, i, `tok-${i}`);
            }

            // Connected 이벤트는 비동기로 마이크로태스크에서 해소될 수 있으므로 충분히 대기.
            const deadline = Date.now() + 5000;
            while(HANDLERS.length < N && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 20));
            }

            expect(HANDLERS.length).toBeGreaterThanOrEqual(N);
            // 100/100 정의 검증.
            let defined = 0;
            for(const h of HANDLERS.slice(0, N)) {
                if(h.handlerID !== undefined && h.sessionID !== undefined && h.bindingToken !== undefined
                    && h.handlerType === HandlerType.Data
                    && (h.dataHandlerState === DataHandlerState.Initializing
                        || h.dataHandlerState === DataHandlerState.ConnectingEndPoint)) {
                    defined++;
                }
            }
            expect(defined).toBe(N);

            // cleanup
            try { client.destroy(); } catch { /* noop */ }
        } finally {
            await server.close();
        }
    });
});
