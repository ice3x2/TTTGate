/**
 * R2-REQ-02 — BufferReader/BufferWriter 엔디언 일관화 검증.
 *
 * 테스트 원칙 (SPEC §5):
 *  - NO-MOCK: 실제 Buffer / 실제 BufferReader·BufferWriter 만 사용.
 *  - LIVE-PROCESS: 실 직렬화 round-trip.
 *  - NEGATIVE TESTS: 교차 엔디언 실패 케이스 증명.
 */
import * as fs from "fs";
import BufferReader from "../../src/util/BufferReader";
import BufferWriter from "../../src/util/BufferWriter";
import { CtrlPacket, ParsedState } from "../../src/commons/CtrlPacket";
import DataStatePacket from "../../src/commons/DataStatePacket";

describe("R2-REQ-02 BufferReader/Writer endian consistency", () => {
    describe("BE 기본 메서드 round-trip (공식 Node.js Buffer BE API 환원)", () => {
        test("UInt8 0x80 round-trip", () => {
            const w = new BufferWriter();
            w.writeUInt8(0x80);
            const r = new BufferReader(w.toBuffer());
            expect(r.readUInt8()).toBe(0x80);
        });

        test("Int8 -1 round-trip (NF-01: readIntLE 위임 체인 우회 증명)", () => {
            const w = new BufferWriter();
            w.writeInt8(-1);
            const r = new BufferReader(w.toBuffer());
            expect(r.readInt8()).toBe(-1);
        });

        test("Int8 -128 경계", () => {
            const w = new BufferWriter();
            w.writeInt8(-128);
            const r = new BufferReader(w.toBuffer());
            expect(r.readInt8()).toBe(-128);
        });

        test("UInt16 BE: 0x1234 → bytes [0x12, 0x34]", () => {
            const w = new BufferWriter();
            w.writeUInt16(0x1234);
            const buf = w.toBuffer();
            expect(buf[0]).toBe(0x12);
            expect(buf[1]).toBe(0x34);
            const r = new BufferReader(buf);
            expect(r.readUInt16()).toBe(0x1234);
        });

        test("Int16 BE: -1 round-trip", () => {
            const w = new BufferWriter();
            w.writeInt16(-1);
            const r = new BufferReader(w.toBuffer());
            expect(r.readInt16()).toBe(-1);
        });

        test("UInt32 BE: 0xDEADBEEF → bytes [0xDE, 0xAD, 0xBE, 0xEF]", () => {
            const w = new BufferWriter();
            w.writeUInt32(0xDEADBEEF);
            const buf = w.toBuffer();
            expect(buf[0]).toBe(0xDE);
            expect(buf[1]).toBe(0xAD);
            expect(buf[2]).toBe(0xBE);
            expect(buf[3]).toBe(0xEF);
            const r = new BufferReader(buf);
            expect(r.readUInt32()).toBe(0xDEADBEEF);
        });

        test("Int32 BE: -1 round-trip", () => {
            const w = new BufferWriter();
            w.writeInt32(-1);
            const r = new BufferReader(w.toBuffer());
            expect(r.readInt32()).toBe(-1);
        });

        test("Int64 BE: max/min round-trip", () => {
            const w = new BufferWriter();
            w.writeInt64(0x7FFFFFFFFFFFFFFFn);
            const r = new BufferReader(w.toBuffer());
            expect(r.readInt64()).toBe(0x7FFFFFFFFFFFFFFFn);
        });
    });

    describe("명시적 LE suffix 메서드 round-trip", () => {
        test("UInt16LE: 0x1234 → bytes [0x34, 0x12]", () => {
            const buf = Buffer.alloc(2);
            buf.writeUInt16LE(0x1234, 0);
            expect(buf[0]).toBe(0x34);
            expect(buf[1]).toBe(0x12);
            const r = new BufferReader(buf);
            expect(r.readUInt16LE()).toBe(0x1234);
        });

        test("UInt32LE: 0xDEADBEEF", () => {
            const buf = Buffer.alloc(4);
            buf.writeUInt32LE(0xDEADBEEF, 0);
            const r = new BufferReader(buf);
            expect(r.readUInt32LE()).toBe(0xDEADBEEF);
        });

        test("Int16LE: -1", () => {
            const buf = Buffer.alloc(2);
            buf.writeInt16LE(-1, 0);
            const r = new BufferReader(buf);
            expect(r.readInt16LE()).toBe(-1);
        });

        test("Int32LE: -12345678", () => {
            const buf = Buffer.alloc(4);
            buf.writeInt32LE(-12345678, 0);
            const r = new BufferReader(buf);
            expect(r.readInt32LE()).toBe(-12345678);
        });
    });

    describe("NEGATIVE — 교차 엔디언 실패", () => {
        test("BE로 쓰고 LE로 읽으면 다른 값 (UInt16)", () => {
            const w = new BufferWriter();
            w.writeUInt16(0x1234);
            const r = new BufferReader(w.toBuffer());
            // BE bytes [0x12, 0x34] → LE 해석 시 0x3412
            expect(r.readUInt16LE()).toBe(0x3412);
        });

        test("BE로 쓰고 LE로 읽으면 다른 값 (UInt32)", () => {
            const w = new BufferWriter();
            w.writeUInt32(0x01020304);
            const r = new BufferReader(w.toBuffer());
            expect(r.readUInt32LE()).toBe(0x04030201);
        });
    });

    describe("프로토콜 회귀 — CtrlPacket/DataStatePacket hex 스냅샷", () => {
        test("CtrlPacket.createSyncCtrl round-trip", () => {
            const pkt = CtrlPacket.createSyncCtrl();
            const buf = pkt.toBuffer();
            // PREFIX('CTRL') + cmd(1) + ID(2) + sessionID(4) + dataLen(4) = 15B
            expect(buf.length).toBe(CtrlPacket.HEADER_LEN);
            expect(buf.subarray(0, 4).toString()).toBe("CTRL");

            const parsed = CtrlPacket.fromBuffer(buf);
            expect(parsed.state).toBe(ParsedState.Complete);
            expect(parsed.packet!.cmd).toBe(0); // SyncCtrl
        });

        test("CtrlPacket.createAckCtrl round-trip (string + BE)", () => {
            const pkt = CtrlPacket.createAckCtrl(42, "clientA", "keyB");
            const buf = pkt.toBuffer();
            const parsed = CtrlPacket.fromBuffer(buf);
            expect(parsed.state).toBe(ParsedState.Complete);
            expect(parsed.packet!.ID).toBe(42);
            expect(parsed.packet!.clientName).toBe("clientA");
            expect(parsed.packet!.ackKey).toBe("keyB");
        });

        test("DataStatePacket BE hex 스냅샷 (BufferReader 변경 독립 증명)", () => {
            const pkt = DataStatePacket.create(0x01020304, 0x05060708, 0x090A0B0C);
            const buf = pkt.toBuffer();
            // PREFIX (10B 'DATA_STATE') + ctrlID BE(4) + handlerID BE(4) + firstSessionID BE(4) = 22B
            const hex = buf.toString("hex");
            // BE 확인: 0x01020304 → '01020304'
            expect(hex).toContain("01020304");
            expect(hex).toContain("05060708");
            expect(hex).toContain("090a0b0c");

            const parsed = DataStatePacket.fromBuffer(buf);
            expect(parsed.packet!.ctrlID).toBe(0x01020304);
            expect(parsed.packet!.handlerID).toBe(0x05060708);
            expect(parsed.packet!.firstSessionID).toBe(0x090A0B0C);
        });
    });

    describe("NF-01 정적 증명 — readInt8/readUInt8 위임 체인 제거", () => {
        test("BufferReader.ts 소스에서 readInt8/readUInt8 구현이 readIntLE/readUIntLE를 호출하지 않음", () => {
            const src = fs.readFileSync(
                require.resolve("../../src/util/BufferReader.ts"),
                "utf8"
            );
            // readInt8() { ... } 블록 추출
            const int8Match = src.match(/public readInt8\(\)[^}]+\}/);
            const uint8Match = src.match(/public readUInt8\(\)[^}]+\}/);
            expect(int8Match).not.toBeNull();
            expect(uint8Match).not.toBeNull();
            expect(int8Match![0]).not.toMatch(/readIntLE|readUIntLE/);
            expect(uint8Match![0]).not.toMatch(/readIntLE|readUIntLE/);
            // 직접 호출 증명
            expect(int8Match![0]).toMatch(/readInt8\(0\)/);
            expect(uint8Match![0]).toMatch(/readUInt8\(0\)/);
        });

        test("BE 기본 메서드 6종 구현 블록에 Math.pow(256 0건", () => {
            const src = fs.readFileSync(
                require.resolve("../../src/util/BufferReader.ts"),
                "utf8"
            );
            const targets = [
                /public readInt8\(\)[^}]+\}/,
                /public readInt16\(\)[^}]+\}/,
                /public readInt32\(\)[^}]+\}/,
                /public readUInt8\(\)[^}]+\}/,
                /public readUInt16\(\)[^}]+\}/,
                /public readUInt32\(\)[^}]+\}/
            ];
            for (const re of targets) {
                const m = src.match(re);
                expect(m).not.toBeNull();
                expect(m![0]).not.toMatch(/Math\.pow\(256/);
            }
        });
    });
});
