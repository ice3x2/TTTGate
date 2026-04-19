import {CtrlCmd, CtrlPacket, CtrlPacketStreamer, ParsedState} from "../../../src/commons/CtrlPacket";
import {CONTROL_PROTOCOL_V2} from "../../../src/commons/ProtocolV2";

describe("CtrlPacket baseline contract", () => {
    it("roundtrips open-session packets without changing the payload contract", () => {
        const packet = CtrlPacket.connectEndPoint(7, 42, {
            host: "127.0.0.1",
            port: 18080,
            tls: true,
            bufferLimit: 2048
        });

        const result = CtrlPacket.fromBuffer(packet.toBuffer());

        expect(result.state).toBe(ParsedState.Complete);
        expect(result.packet?.cmd).toBe(CtrlCmd.OpenSession);
        expect(result.packet?.ID).toBe(7);
        expect(result.packet?.sessionID).toBe(42);
        expect(result.packet?.openOpt).toEqual({
            host: "127.0.0.1",
            port: 18080,
            tls: true,
            bufferLimit: 2048
        });
    });

    it("reassembles fragmented packets through the existing streamer contract", () => {
        const streamer = new CtrlPacketStreamer();
        const packet = CtrlPacket.message(3, {type: "log", payload: "baseline"});
        const buffer = packet.toBuffer();

        expect(streamer.readCtrlPacketList(buffer.subarray(0, 6))).toEqual([]);

        const packets = streamer.readCtrlPacketList(buffer.subarray(6));

        expect(packets).toHaveLength(1);
        expect(packets[0].cmd).toBe(CtrlCmd.Message);
        expect(CtrlPacket.getMessageFromPacket(packets[0])).toEqual({
            type: "log",
            payload: "baseline"
        });
    });

    it("roundtrips protocol v2 handshake metadata without breaking AckCtrl compatibility", () => {
        const packet = CtrlPacket.createAckCtrl(9, "display-name", "legacy-key", {
            protocolVersion: CONTROL_PROTOCOL_V2,
            capabilities: ["protocol-v2", "proof-of-possession"],
            controlID: 9,
            clientId: "client-a",
            displayName: "Client A",
            proof: "proof-value"
        });

        const result = CtrlPacket.fromBuffer(packet.toBuffer());

        expect(result.packet?.clientName).toBe("display-name");
        expect(result.packet?.ackKey).toBe("legacy-key");
        expect(result.packet?.ackCtrlV2Meta).toEqual({
            protocolVersion: CONTROL_PROTOCOL_V2,
            capabilities: ["protocol-v2", "proof-of-possession"],
            controlID: 9,
            clientId: "client-a",
            displayName: "Client A",
            proof: "proof-value"
        });
    });

    it("preserves wide IDs through v2 metadata when the 16-bit header would overflow", () => {
        const packet = CtrlPacket.createSyncCtrlAck(70000, {
            protocolVersion: CONTROL_PROTOCOL_V2,
            capabilities: ["wide-id"],
            challengeNonce: "nonce",
            serverMode: "mixed",
            controlID: 70000
        });

        const result = CtrlPacket.fromBuffer(packet.toBuffer());

        expect(result.packet?.ID).toBe(70000 & 0xffff);
        expect(result.packet?.syncCtrlAckMeta?.controlID).toBe(70000);
    });

    it("roundtrips full handler IDs for v2 data-handler packets", () => {
        const newHandler = CtrlPacket.newDataHandler(70010, 55, {
            handlerID: 70010,
            bindingToken: "binding-token"
        });
        const resultPacket = CtrlPacket.resultOfOpenSession(70010, 55, true, {
            handlerID: 70010
        });

        const newHandlerResult = CtrlPacket.fromBuffer(newHandler.toBuffer());
        const resultOfOpen = CtrlPacket.fromBuffer(resultPacket.toBuffer());

        expect(newHandlerResult.packet?.newDataHandlerMeta).toEqual({
            handlerID: 70010,
            bindingToken: "binding-token"
        });
        expect(resultOfOpen.packet?.handlerWideIdMeta).toEqual({
            handlerID: 70010
        });
    });
});
