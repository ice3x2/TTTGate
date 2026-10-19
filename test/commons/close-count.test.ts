import {CtrlCmd, CtrlPacket, ParsedState} from '../../src/commons/CtrlPacket';

const large = 0x100000000;
function raw(prefix: number, suffix = '') {
    const payload = Buffer.alloc(4); payload.writeUInt32BE(prefix);
    const body = Buffer.concat([payload, Buffer.from(suffix)]);
    const header = Buffer.alloc(15); header.write('CTRL'); header[4] = CtrlCmd.CloseSession;
    header.writeUInt16BE(7, 5); header.writeUInt32BE(9, 7); header.writeUInt32BE(body.length, 11);
    return Buffer.concat([header, body]);
}
const parse = (bytes: Buffer) => { const result = CtrlPacket.fromBuffer(bytes); expect(result.state).toBe(ParsedState.Complete); return result.packet! as any; };
test.each([0, 1, 0xffffffff])('small count %s preserves old bytes and legacy interpretation', count => {
    for(const meta of [undefined, {handlerID: 7}]) {
        const bytes = CtrlPacket.closeSession(7, 9, count, meta).toBuffer();
        expect(bytes).toEqual(raw(count, meta ? JSON.stringify(meta) : ''));
        for(const support of [false, true]) expect(parse(bytes).readCloseSessionCount(support)).toEqual({kind: 'valid', value: {count, handlerID: meta?.handlerID}});
    }
});
test.each([large, large + 123, Number.MAX_SAFE_INTEGER])('negotiated count %s roundtrips exactly', count => {
    const bytes = (CtrlPacket.closeSession as any)(7, 9, count, {handlerID: 7}, true).toBuffer();
    expect(bytes).toEqual(raw(0xffffffff, JSON.stringify({handlerID: 7, waitReceiveLength: count})));
    expect(parse(bytes).readCloseSessionCount(true)).toEqual({kind: 'valid', value: {count, handlerID: 7}});
    expect(parse(bytes).readCloseSessionCount(false).kind).toBe('invalid');
});
test.each(['{"waitReceiveLength":null}', '{"waitReceiveLength":"4294967296"}', '{"waitReceiveLength":1}', '{"waitReceiveLength":4294967296.5}', '{"waitReceiveLength":9007199254740992}', '{bad'])('invalid present extension never falls back: %s', suffix => {
    expect(parse(raw(0xffffffff, suffix)).readCloseSessionCount(true).kind).toBe('invalid');
});
test('extension requires marker and factory refuses contradictory metadata', () => {
    expect(parse(raw(1, JSON.stringify({waitReceiveLength: large}))).readCloseSessionCount(true).kind).toBe('invalid');
    expect(() => (CtrlPacket.closeSession as any)(7, 9, 1, {waitReceiveLength: large}, true)).toThrow(RangeError);
    expect(() => (CtrlPacket.closeSession as any)(7, 9, large, undefined, false)).toThrow(RangeError);
});
