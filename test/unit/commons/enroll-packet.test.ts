import {CtrlCmd, CtrlPacket, CtrlPacketStreamer} from "../../../src/commons/CtrlPacket";

// #212 REQ-5: 등록 교환 패킷. 기존 명령 번호는 그대로 두고 뒤에 붙인다(구버전과 번호가 엇갈리지 않게).
describe("enrollment control packets", () => {
    test("existing command numbers do not move", () => {
        expect(CtrlCmd.SyncCtrl).toBe(0);
        expect(CtrlCmd.Message).toBe(9);
        expect(CtrlCmd.EnrollRequest).toBe(10);
        expect(CtrlCmd.EnrollResponse).toBe(11);
    });

    test("a request carries the protocol and lookup value and round-trips through the streamer", () => {
        const lookup = "ab".repeat(32);
        const bytes = CtrlPacket.createEnrollRequest({protocol: "tttgate-enroll-v1", lookup}).toBuffer();
        const [packet] = new CtrlPacketStreamer().readCtrlPacketList(bytes);
        expect(packet.cmd).toBe(CtrlCmd.EnrollRequest);
        expect(packet.enrollRequestMetaResult).toEqual({kind: "valid", value: {protocol: "tttgate-enroll-v1", lookup}});
    });

    test("a request with a bad lookup value is invalid", () => {
        const bytes = CtrlPacket.createEnrollRequest({protocol: "tttgate-enroll-v1", lookup: "not-hex"}).toBuffer();
        const [packet] = new CtrlPacketStreamer().readCtrlPacketList(bytes);
        expect(packet.enrollRequestMetaResult.kind).toBe("invalid");
    });

    test("responses carry a sealed payload or a reason", () => {
        const sealed = {ok: true as const, nonce: "bm9uY2U=", ciphertext: "Y2lwaGVy", tag: "dGFn"};
        const [ok] = new CtrlPacketStreamer().readCtrlPacketList(CtrlPacket.createEnrollResponse(sealed).toBuffer());
        expect(ok.enrollResponseMetaResult).toEqual({kind: "valid", value: sealed});
        const [rejected] = new CtrlPacketStreamer().readCtrlPacketList(
            CtrlPacket.createEnrollResponse({ok: false, reason: "rejected"}).toBuffer());
        expect(rejected.enrollResponseMetaResult).toEqual({kind: "valid", value: {ok: false, reason: "rejected"}});
    });
});
