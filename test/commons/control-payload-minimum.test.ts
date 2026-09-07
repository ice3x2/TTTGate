import {CtrlCmd, CtrlPacket, CtrlPacketStreamer, ParsedState} from "../../src/commons/CtrlPacket";

const frame = (cmd: CtrlCmd, data: Buffer): Buffer => {
    const header = Buffer.from(CtrlPacket.closeSession(7, 42, 0).toBuffer().subarray(0, CtrlPacket.HEADER_LEN));
    header.writeUInt8(cmd, CtrlPacket.PREFIX_LEN);
    header.writeUInt32BE(data.length, CtrlPacket.HEADER_LEN - 4);
    return Buffer.concat([header, data]);
};

describe("control command payload boundaries (#9)", () => {
    test.each([0, 1, 2, 3])("rejects a complete CloseSession with %i payload bytes", (length) => {
        const result = CtrlPacket.fromBuffer(frame(CtrlCmd.CloseSession, Buffer.alloc(length)));
        expect(result.state).not.toBe(ParsedState.Complete);
        expect(result.packet).toBeNull();
        expect(result.error).toBeInstanceOf(Error);
    });

    test.each([0, 1, 2, 3])("short in-memory CloseSession getter is bounded at %i bytes", (length) => {
        const packet = CtrlPacket.closeSession(7, 42, 0);
        (packet as any)._data = Buffer.alloc(length);
        expect(packet.waitReceiveLength).toBe(0);
    });

    test.each([
        [CtrlCmd.AckCtrl, Buffer.alloc(3)],
        [CtrlCmd.OpenSession, Buffer.alloc(8)],
        [CtrlCmd.AckCtrl, Buffer.from([0, 4, 65, 65])],
        [CtrlCmd.AckCtrl, Buffer.from([0, 0, 0, 4])],
        [CtrlCmd.OpenSession, Buffer.from([0, 8, 65, 65, 65, 65, 65, 65, 65])],
    ])("rejects incomplete required fields for command %i without throwing", (cmd, data) => {
        const result = CtrlPacket.fromBuffer(frame(cmd as CtrlCmd, data as Buffer));
        expect(result.state).not.toBe(ParsedState.Complete);
        expect(result.packet).toBeNull();
        expect(result.error).toBeInstanceOf(Error);
    });

    test("waits for the declared malformed payload before discarding precisely that frame", () => {
        const streamer = new CtrlPacketStreamer();
        const invalid = frame(CtrlCmd.CloseSession, Buffer.alloc(3));
        const valid = CtrlPacket.closeSession(7, 42, 12);
        expect(streamer.readCtrlPacketList(invalid.subarray(0, CtrlPacket.HEADER_LEN))).toEqual([]);
        const packets = streamer.readCtrlPacketList(Buffer.concat([
            invalid.subarray(CtrlPacket.HEADER_LEN), valid.toBuffer(),
        ]));
        expect(packets).toHaveLength(1);
        expect(packets[0].waitReceiveLength).toBe(12);
    });

    test("preserves valid packets surrounding an invalid payload in one receive", () => {
        const streamer = new CtrlPacketStreamer();
        const packets = streamer.readCtrlPacketList(Buffer.concat([
            CtrlPacket.closeSession(7, 41, 10).toBuffer(),
            frame(CtrlCmd.CloseSession, Buffer.alloc(0)),
            CtrlPacket.closeSession(7, 43, 20).toBuffer(),
        ]));
        expect(packets.map((packet) => packet.sessionID)).toEqual([41, 43]);
    });

    test("discards a bounded burst without recursive stack growth", () => {
        const streamer = new CtrlPacketStreamer();
        const invalid = frame(CtrlCmd.CloseSession, Buffer.alloc(0));
        const packets = streamer.readCtrlPacketList(Buffer.concat([
            ...Array(4000).fill(invalid), CtrlPacket.createSyncCtrl().toBuffer(),
        ]));
        expect(packets.map((packet) => packet.cmd)).toEqual([CtrlCmd.SyncCtrl]);
    });

    test("keeps valid legacy and extended close payloads compatible", () => {
        for (const count of [0, 0xffffffff]) {
            const legacy = CtrlPacket.fromBuffer(CtrlPacket.closeSession(7, 42, count).toBuffer());
            const extended = CtrlPacket.fromBuffer(CtrlPacket.closeSession(7, 42, count, {handlerID: 70007}).toBuffer());
            expect(legacy.packet?.waitReceiveLength).toBe(count);
            expect(extended.packet?.waitReceiveLength).toBe(count);
            expect(extended.packet?.handlerWideIdMeta).toEqual({handlerID: 70007});
        }
    });
});
