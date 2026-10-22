/**
 * R2-REQ-01 — CtrlPacket 페이로드 한도 재정의 검증.
 * NO-MOCK: 실 Buffer + 실 CtrlPacket.
 */
import { CtrlPacket, CtrlCmd, ParsedState } from "../../src/commons/CtrlPacket";

const MAX = 64000;

function buildRaw(cmd: CtrlCmd, payload: Buffer, dataLenOverride?: number): Buffer {
    const PREFIX = Buffer.from("CTRL");
    const headerRest = Buffer.alloc(1 + 2 + 4 + 4);
    headerRest.writeUInt8(cmd, 0);
    headerRest.writeUInt16BE(0, 1);
    headerRest.writeUInt32BE(0, 3);
    headerRest.writeUInt32BE(dataLenOverride ?? payload.length, 7);
    return Buffer.concat([PREFIX, headerRest, payload]);
}

describe("R2-REQ-01 CtrlPacket payload limit (pure payload, header 제외)", () => {
    test("64000B 페이로드 정상 파싱", () => {
        const payload = Buffer.alloc(MAX, 0x41);
        const raw = buildRaw(CtrlCmd.Message, payload);
        const parsed = CtrlPacket.fromBuffer(raw);
        expect(parsed.state).toBe(ParsedState.Complete);
        expect(parsed.packet!.data.length).toBe(MAX);
    });

    test("64001B 페이로드 거부 (Data length too large)", () => {
        const raw = buildRaw(CtrlCmd.Message, Buffer.alloc(0), MAX + 1);
        const parsed = CtrlPacket.fromBuffer(raw);
        expect(parsed.state).toBe(ParsedState.Error);
        expect(String(parsed.error?.message || "")).toMatch(/Data length too large/);
    });

    test("dataLength=0xFFFFFFFF(4GB) 거부", () => {
        const raw = buildRaw(CtrlCmd.Message, Buffer.alloc(0), 0xFFFFFFFF);
        const parsed = CtrlPacket.fromBuffer(raw);
        expect(parsed.state).toBe(ParsedState.Error);
    });

    test("송신 측: 64001B 데이터를 가진 패킷 toBuffer는 RangeError throw", () => {
        // 내부 _data 직접 설정은 불가 → message()로 거대 payload 생성.
        const hugeMsg = { type: "x", payload: "a".repeat(MAX) };
        const pkt = CtrlPacket.message(0, hugeMsg);
        // JSON serialize 크기가 MAX 초과인지 확인 후 toBuffer.
        if(pkt.data.length > MAX) {
            expect(() => pkt.toBuffer()).toThrow(RangeError);
        } else {
            // 경계 케이스: 정확히 MAX 이하면 정상.
            expect(() => pkt.toBuffer()).not.toThrow();
        }
    });

    test("CtrlPacket.ts 소스에서 'MAX_PAYLOAD_SIZE + this.HEADER_LEN' 표현 0건 (NF-03-eval1)", () => {
        const fs = require("fs");
        const src = fs.readFileSync(require.resolve("../../src/commons/CtrlPacket.ts"), "utf8");
        expect(src).not.toMatch(/MAX_PAYLOAD_SIZE\s*\+\s*this\.HEADER_LEN/);
    });
});
