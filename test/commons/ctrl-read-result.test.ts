import {CtrlPacket, CtrlPacketStreamer, CtrlCmd} from '../../src/commons/CtrlPacket';

const read = (stream: CtrlPacketStreamer, buffer: Buffer) => (stream as any).readCtrlPacketResult(buffer);
const good = () => CtrlPacket.createSyncCtrl().toBuffer();
function malformed(mode: string) {
    const frame = good();
    if(mode === 'prefix') frame[0] ^= 255;
    if(mode === 'command') frame[CtrlPacket.PREFIX_LEN] = 255;
    if(mode === 'length') frame.writeUInt32BE(64001, CtrlPacket.HEADER_LEN - 4);
    return frame;
}
export {malformed};

test.each(['prefix', 'command', 'length'])('result drops complete fatal %s batch and resets for a fresh input', mode => {
    const stream = new CtrlPacketStreamer();
    const result = read(stream, Buffer.concat([good(), malformed(mode), good()]));
    expect(result.packets).toEqual([]); expect(result.error.kind).toBe('framing');
    expect((stream as any)._pendingBytes).toBe(0);
    expect(read(stream, good()).packets).toHaveLength(1);
});

test('result overflow never invokes callback while legacy default/callback policies stay intact', () => {
    let calls = 0;
    const stream = new CtrlPacketStreamer({maxPendingBytes: 20, onOverflow: () => calls++});
    expect(read(stream, Buffer.alloc(21)).error.kind).toBe('overflow'); expect(calls).toBe(0);
    expect((stream as any)._pendingBytes).toBe(0);
    stream.feed(Buffer.alloc(21)); expect(calls).toBe(1);
    expect(() => new CtrlPacketStreamer({maxPendingBytes: 20}).feed(Buffer.alloc(21))).toThrow(RangeError);
});

test('result preserves every valid split, coalescing and existing discarded short-command continuation', () => {
    for(let cut = 0; cut < good().length; cut++) {
        const stream = new CtrlPacketStreamer();
        expect(read(stream, good().subarray(0, cut)).packets).toEqual([]);
        expect(read(stream, Buffer.concat([good().subarray(cut), good()])).packets).toHaveLength(2);
    }
    const short = good(); short[CtrlPacket.PREFIX_LEN] = CtrlCmd.CloseSession;
    expect(read(new CtrlPacketStreamer(), Buffer.concat([short, good()])).packets).toHaveLength(1);
});

test('legacy framing throw retains queued later buffers, without adopting fatal-batch reset', () => {
    const stream = new CtrlPacketStreamer(); stream.feed(malformed('prefix')); stream.feed(good());
    expect(() => stream.readPacket()).toThrow();
    expect(stream.readPacket()?.cmd).toBe(CtrlCmd.SyncCtrl);
});
