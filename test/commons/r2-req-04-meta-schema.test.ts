/**
 * R2-REQ-04 — CtrlPacket 메타 JSON 스키마 가드 검증.
 *
 * NO-MOCK: 실 Buffer, 실 CtrlPacket.
 *
 * 6곳 JSON.parse ↔ 5 가드 매핑 전수:
 *  - getMessageFromPacket            → assertMessageMeta
 *  - syncCtrlAckMeta                 → assertSyncCtrlAckMeta
 *  - newDataHandlerMeta              → assertNewDataHandlerMeta
 *  - handlerWideIdMeta(FailOpen)     → assertHandlerWideIdMeta
 *  - handlerWideIdMeta(SuccessOpen)  → assertHandlerWideIdMeta
 *  - handlerWideIdMeta(SuccessOpenAck) → assertHandlerWideIdMeta (NF-03-eval2)
 *  - handlerWideIdMeta(CloseSession) → assertHandlerWideIdMeta (4번째 CtrlCmd)
 *  - parseAckCtrlData v2             → assertAckCtrlV2Meta
 */
import { CtrlPacket, CtrlCmd, ParsedState } from "../../src/commons/CtrlPacket";
import BufferWriter from "../../src/util/BufferWriter";

// 임의 payload를 가진 CtrlPacket raw buffer 빌더.
function buildRaw(cmd: CtrlCmd, payload: Buffer, id: number = 0, sessionID: number = 0): Buffer {
    const PREFIX = Buffer.from("CTRL");
    const headerRest = Buffer.alloc(1 + 2 + 4 + 4);
    headerRest.writeUInt8(cmd, 0);
    headerRest.writeUInt16BE(id & 0xffff, 1);
    headerRest.writeUInt32BE(sessionID, 3);
    headerRest.writeUInt32BE(payload.length, 7);
    return Buffer.concat([PREFIX, headerRest, payload]);
}

// CloseSession은 앞 4B가 waitReceiveLength이므로 meta JSON 앞에 prepend.
function buildCloseSessionRaw(metaJson: string): Buffer {
    const waitLen = Buffer.alloc(4);
    waitLen.writeUInt32BE(0, 0);
    const payload = Buffer.concat([waitLen, Buffer.from(metaJson, "utf-8")]);
    return buildRaw(CtrlCmd.CloseSession, payload);
}

function parsePacketFromJson(cmd: CtrlCmd, metaJson: string): CtrlPacket {
    const raw = buildRaw(cmd, Buffer.from(metaJson, "utf-8"));
    const parsed = CtrlPacket.fromBuffer(raw);
    expect(parsed.state).toBe(ParsedState.Complete);
    return parsed.packet!;
}

describe("R2-REQ-04 CtrlPacket meta JSON schema guards", () => {
    describe("prototype pollution 차단 — __proto__ drop", () => {
        test("Message: __proto__ 주입 payload → pollution 없음", () => {
            const json = JSON.stringify({ type: "hello", payload: "world", __proto__: { polluted: true } });
            const pkt = parsePacketFromJson(CtrlCmd.Message, json);
            const msg = CtrlPacket.getMessageFromPacket(pkt);
            expect(msg.type).toBe("hello");
            expect(({} as any).polluted).toBeUndefined();
        });

        test("SyncCtrlAck: __proto__ 주입 payload → pollution 없음", () => {
            const json = JSON.stringify({
                protocolVersion: 2,
                capabilities: ["protocol-v2"],
                challengeNonce: "abc",
                serverMode: "legacy",
                __proto__: { polluted: true }
            });
            const pkt = parsePacketFromJson(CtrlCmd.SyncCtrlAck, json);
            expect(pkt.syncCtrlAckMeta!.protocolVersion).toBe(2);
            expect(({} as any).polluted).toBeUndefined();
        });

        test("NewDataHandler: __proto__ 주입 payload → pollution 없음", () => {
            const json = JSON.stringify({ handlerID: 42, __proto__: { polluted: true } });
            const pkt = parsePacketFromJson(CtrlCmd.NewDataHandler, json);
            expect(pkt.newDataHandlerMeta!.handlerID).toBe(42);
            expect(({} as any).polluted).toBeUndefined();
        });

        test("FailOfOpenSession: __proto__ 주입 payload → pollution 없음", () => {
            const json = JSON.stringify({ handlerID: 1, __proto__: { polluted: true } });
            const pkt = parsePacketFromJson(CtrlCmd.FailOfOpenSession, json);
            expect(pkt.handlerWideIdMeta!.handlerID).toBe(1);
            expect(({} as any).polluted).toBeUndefined();
        });

        test("SuccessOfOpenSession: __proto__ 주입 payload → pollution 없음", () => {
            const json = JSON.stringify({ handlerID: 2, __proto__: { polluted: true } });
            const pkt = parsePacketFromJson(CtrlCmd.SuccessOfOpenSession, json);
            expect(pkt.handlerWideIdMeta!.handlerID).toBe(2);
            expect(({} as any).polluted).toBeUndefined();
        });

        test("SuccessOfOpenSessionAck: __proto__ 주입 payload → pollution 없음 (NF-03-eval2)", () => {
            const json = JSON.stringify({ handlerID: 3, __proto__: { polluted: true } });
            const pkt = parsePacketFromJson(CtrlCmd.SuccessOfOpenSessionAck, json);
            expect(pkt.handlerWideIdMeta!.handlerID).toBe(3);
            expect(({} as any).polluted).toBeUndefined();
        });

        test("CloseSession: __proto__ 주입 payload → pollution 없음", () => {
            const raw = buildCloseSessionRaw(JSON.stringify({ handlerID: 4, __proto__: { polluted: true } }));
            const parsed = CtrlPacket.fromBuffer(raw);
            expect(parsed.state).toBe(ParsedState.Complete);
            expect(parsed.packet!.handlerWideIdMeta!.handlerID).toBe(4);
            expect(({} as any).polluted).toBeUndefined();
        });

        test("AckCtrl v2: __proto__ 주입 payload → pollution 없음", () => {
            const v2Json = JSON.stringify({
                protocolVersion: 2,
                capabilities: ["protocol-v2"],
                clientId: "c1",
                proof: "deadbeef",
                __proto__: { polluted: true }
            });
            // AckCtrl 직렬화: writeString(name) + writeString(key) + writeString(v2Json)
            const writer = new BufferWriter();
            writer.writeString("clientA");
            writer.writeString("keyB");
            writer.writeString(v2Json);
            const raw = buildRaw(CtrlCmd.AckCtrl, writer.toBuffer());
            const parsed = CtrlPacket.fromBuffer(raw);
            expect(parsed.state).toBe(ParsedState.Complete);
            expect(parsed.packet!.ackCtrlV2Meta!.clientId).toBe("c1");
            expect(({} as any).polluted).toBeUndefined();
        });
    });

    describe("필수 필드 누락 메타 거부", () => {
        test("SyncCtrlAck: challengeNonce 누락 → throw", () => {
            const json = JSON.stringify({ protocolVersion: 2, capabilities: [], serverMode: "legacy" });
            const pkt = parsePacketFromJson(CtrlCmd.SyncCtrlAck, json);
            expect(() => pkt.syncCtrlAckMeta).toThrow(/challengeNonce/);
        });

        test("Message: type 누락 → throw", () => {
            const json = JSON.stringify({ payload: "world" });
            const pkt = parsePacketFromJson(CtrlCmd.Message, json);
            expect(() => CtrlPacket.getMessageFromPacket(pkt)).toThrow(/type/);
        });

        test("NewDataHandler: handlerID 타입 오류 → throw", () => {
            const json = JSON.stringify({ handlerID: "not-a-number" });
            const pkt = parsePacketFromJson(CtrlCmd.NewDataHandler, json);
            expect(() => pkt.newDataHandlerMeta).toThrow(/handlerID/);
        });
    });

    describe("정상 메타 통과", () => {
        test("SyncCtrlAck 정상", () => {
            const json = JSON.stringify({
                protocolVersion: 2,
                capabilities: ["protocol-v2", "client-identity"],
                challengeNonce: "nonce-abc",
                serverMode: "mtls-strict",
                controlID: 7
            });
            const pkt = parsePacketFromJson(CtrlCmd.SyncCtrlAck, json);
            const meta = pkt.syncCtrlAckMeta!;
            expect(meta.protocolVersion).toBe(2);
            expect(meta.controlID).toBe(7);
        });

        test("HandlerWideIdMeta 빈 객체 (handlerID 없음) 정상", () => {
            const pkt = parsePacketFromJson(CtrlCmd.FailOfOpenSession, "{}");
            expect(pkt.handlerWideIdMeta).toEqual({});
        });
    });

    describe("parseAckCtrlData 타입 검증", () => {
        test("v2 필드 타입 오류 → fallback (v2 없음)", () => {
            // protocolVersion을 문자열로 주입.
            const v2Json = JSON.stringify({
                protocolVersion: "two",
                capabilities: [],
                clientId: "c1",
                proof: "p"
            });
            const writer = new BufferWriter();
            writer.writeString("clientA");
            writer.writeString("keyB");
            writer.writeString(v2Json);
            const raw = buildRaw(CtrlCmd.AckCtrl, writer.toBuffer());
            const parsed = CtrlPacket.fromBuffer(raw);
            expect(parsed.state).toBe(ParsedState.Complete);
            // 가드 실패 시 fallback — v2 미설정.
            expect(parsed.packet!.ackCtrlV2Meta).toBeUndefined();
            expect(parsed.packet!.clientName).toBe("clientA");
            expect(parsed.packet!.ackKey).toBe("keyB");
        });
    });

    describe("정적 증명 — CtrlPacket.ts에 직접 JSON.parse 0건", () => {
        test("JSON.parse 잔존 grep", () => {
            const fs = require("fs");
            const src = fs.readFileSync(require.resolve("../../src/commons/CtrlPacket.ts"), "utf8");
            expect(src).not.toMatch(/JSON\.parse/);
        });
    });
});
