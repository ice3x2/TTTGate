/**
 * R2-REQ-03 — CtrlPacketStreamer 누적 버퍼 상한 검증.
 * NO-MOCK: 실 Buffer + 실 Streamer.
 */
import { CtrlPacket, CtrlPacketStreamer } from "../../src/commons/CtrlPacket";

describe("R2-REQ-03 CtrlPacketStreamer pending bytes overflow", () => {
    test("onOverflow 콜백 경로: 헤더 조각 반복 feed 시 상한 초과로 콜백 호출 + dequeue 비움", () => {
        let captured: Error | null = null;
        const maxPending = 1024; // 작은 상한으로 빨리 트립.
        const streamer = new CtrlPacketStreamer({
            maxPendingBytes: maxPending,
            onOverflow: (e) => { captured = e; }
        });

        // 5B 헤더 조각을 반복 feed.
        const frag = Buffer.alloc(5, 0x00);
        let feeds = 0;
        while(captured === null && feeds < maxPending) {
            streamer.feed(frag);
            feeds++;
        }

        expect(captured).not.toBeNull();
        expect(String((captured as unknown as Error).message)).toMatch(/overflow/i);
        // dequeue는 비워져 있어야 함 (다음 feed는 다시 시작 가능).
        expect(() => streamer.feed(frag)).not.toThrow();
    });

    test("NF-02: onOverflow 미주입 시 기본 동작은 RangeError throw", () => {
        const streamer = new CtrlPacketStreamer({ maxPendingBytes: 16 });
        const big = Buffer.alloc(32, 0x00);
        expect(() => streamer.feed(big)).toThrow(RangeError);
    });

    test("정상 패킷 분할 전송 회귀 (헤더 8B + 나머지)", () => {
        const streamer = new CtrlPacketStreamer(); // 기본 상한 사용.
        const pkt = CtrlPacket.createSyncCtrl();
        const buf = pkt.toBuffer();
        expect(buf.length).toBe(CtrlPacket.HEADER_LEN);

        // 앞 8B, 나머지 분할
        streamer.feed(buf.subarray(0, 8));
        expect(streamer.readPacket()).toBeNull();
        streamer.feed(buf.subarray(8));
        const parsed = streamer.readPacket();
        expect(parsed).not.toBeNull();
        expect(parsed!.cmd).toBe(0);
    });

    test("DEFAULT_MAX_PENDING_BYTES 상수 정의 존재", () => {
        expect(typeof CtrlPacketStreamer.DEFAULT_MAX_PENDING_BYTES).toBe("number");
        // HEADER_LEN + MAX_PAYLOAD_SIZE * 2 = 15 + 128000 = 128015
        expect(CtrlPacketStreamer.DEFAULT_MAX_PENDING_BYTES).toBe(CtrlPacket.HEADER_LEN + 64000 * 2);
    });
});
