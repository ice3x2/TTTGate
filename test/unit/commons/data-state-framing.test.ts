import DataStatePacket from "../../../src/commons/DataStatePacket";

// Baseline accepts one argument; this cast lets RED exercise behavior, not TS arity.
const decode = (buffer: Buffer, format: "legacy" | "token") =>
    (DataStatePacket.fromBuffer as any)(buffer, format);

test.each(["legacy", "token"] as const)("%s preserves framing and arbitrary suffix at every two-part split", format => {
    const token = format === "token" ? "fixture-token-ß" : undefined;
    const frame = DataStatePacket.create(70001, 70002, 70003, token).toBuffer();
    for(const suffix of [Buffer.alloc(0), Buffer.from([0, 3, 97, 98, 99]), Buffer.from('GET /binary\0\xff', 'latin1')]) {
        const input = Buffer.concat([frame, suffix]);
        for(let split = 0; split <= input.length; split++) {
            let result = decode(input.subarray(0, split), format);
            let tail: Buffer;
            if(result.packet) tail = Buffer.concat([result.remainBuffer, input.subarray(split)]);
            else {
                result = decode(Buffer.concat([result.remainBuffer, input.subarray(split)]), format);
                tail = result.remainBuffer;
            }
            expect({format, split, ctrlID: result.packet?.ctrlID, handlerID: result.packet?.handlerID,
                firstSessionID: result.packet?.firstSessionID, token: result.packet?.bindingToken, tail})
                .toEqual({format, split, ctrlID: 70001, handlerID: 70002, firstSessionID: 70003, token, tail: suffix});
        }
    }
});

test("token frame remains incomplete until its last byte with byte-at-a-time input", () => {
    const frame = DataStatePacket.create(1, 2, 3, 'binding').toBuffer();
    let input = Buffer.alloc(0);
    for(let index = 0; index < frame.length; index++) {
        input = Buffer.concat([input, frame.subarray(index, index + 1)]);
        const result = decode(input, 'token');
        expect(Boolean(result.packet)).toBe(index === frame.length - 1);
        expect(result.error).toBeUndefined();
    }
});

test("invalid prefix is a result diagnostic rather than an exception", () => {
    const invalid = DataStatePacket.create(1, 2, 3).toBuffer(); invalid[1] = 0;
    let result: any;
    expect(() => { result = decode(invalid, 'legacy'); }).not.toThrow();
    expect(result.packet).toBeUndefined();
    expect(result.error).toMatch(/prefix/i);
    expect(result.remainBuffer).toBeUndefined();
});

test("decoder does not silently infer a missing format", () => {
    const result = decode(DataStatePacket.create(1, 2, 3).toBuffer(), undefined as any);
    expect(result.packet).toBeUndefined();
    expect(result.error).toMatch(/format/i);
});

test("fixed-header API distinguishes incomplete, invalid and complete identities", () => {
    const read = (DataStatePacket as any).readFixedHeader;
    expect(typeof read).toBe('function');
    const frame = DataStatePacket.create(70001, 70002, 70003, 'token').toBuffer();
    for(let size = 0; size < DataStatePacket.LENGTH; size++) expect(read(frame.subarray(0, size))).toEqual({kind: 'incomplete'});
    expect(read(frame.subarray(0, DataStatePacket.LENGTH))).toEqual({kind: 'complete', ctrlID: 70001, handlerID: 70002, firstSessionID: 70003});
    const invalid = Buffer.from(frame); invalid[2] = 0;
    expect(read(invalid)).toMatchObject({kind: 'invalid', reason: expect.stringMatching(/prefix/i)});
});

test("producer bytes stay fixed for legacy and optional-token forms", () => {
    const fixed = Buffer.alloc(DataStatePacket.LENGTH);
    fixed.write('DATA_STATE'); fixed.writeUInt32BE(11, 10); fixed.writeUInt32BE(17, 14); fixed.writeUInt32BE(29, 18);
    expect(DataStatePacket.create(11, 17, 29).toBuffer()).toEqual(fixed);
    expect(DataStatePacket.create(11, 17, 29, 'abc').toBuffer()).toEqual(Buffer.concat([fixed, Buffer.from([0, 3, 97, 98, 99])]));
    const zeroLength = decode(Buffer.concat([fixed, Buffer.from([0, 0, 255])]), 'token');
    expect(zeroLength.packet?.bindingToken).toBeUndefined();
    expect(zeroLength.remainBuffer).toEqual(Buffer.from([255]));
});
