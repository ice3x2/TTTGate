import DataStatePacket from "../../../src/commons/DataStatePacket";

describe("DataStatePacket baseline contract", () => {
    it("roundtrips packet fields without altering the binary layout", () => {
        const packet = DataStatePacket.create(11, 17, 29);
        const result = DataStatePacket.fromBuffer(packet.toBuffer(), "legacy");

        expect(result.packet?.ctrlID).toBe(11);
        expect(result.packet?.handlerID).toBe(17);
        expect(result.packet?.firstSessionID).toBe(29);
        expect(result.remainBuffer).toEqual(Buffer.alloc(0));
    });

    it("returns the original buffer when the payload is incomplete", () => {
        const buffer = Buffer.from(DataStatePacket.PREFIX);
        const result = DataStatePacket.fromBuffer(buffer, "legacy");

        expect(result.packet).toBeUndefined();
        expect(result.remainBuffer).toEqual(buffer);
    });

    it("roundtrips an optional binding token for protocol v2 data channel binding", () => {
        const packet = DataStatePacket.create(11, 17, 29, "binding-token");
        const result = DataStatePacket.fromBuffer(packet.toBuffer(), "token");

        expect(result.packet?.bindingToken).toBe("binding-token");
        expect(result.remainBuffer).toEqual(Buffer.alloc(0));
    });
});
