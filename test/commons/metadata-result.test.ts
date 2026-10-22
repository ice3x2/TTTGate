import {CtrlCmd, CtrlPacket} from '../../src/commons/CtrlPacket';
import {metadataFrame} from '../fixtures/metadata-frame';
const read = (cmd: CtrlCmd, payload: string, getter: string) => (CtrlPacket.fromBuffer(metadataFrame(cmd, payload)).packet as any)[getter];
const cases: Array<[CtrlCmd, string, string]> = [
    [CtrlCmd.SyncCtrlAck, 'syncCtrlAckMetaResult', '{"protocolVersion":"bad"}'],
    [CtrlCmd.NewDataHandler, 'newDataHandlerMetaResult', '{"handlerID":-1}'],
    [CtrlCmd.SuccessOfOpenSession, 'handlerWideIdMetaResult', '{"handlerID":"bad"}'],
    [CtrlCmd.Message, 'messageMetaResult', '{"type":9}']];
test.each(cases)('metadata result for command %s distinguishes invalid syntax/schema and optional absence', (cmd, getter, schema) => {
    expect(read(cmd, '{secret-marker', getter)).toEqual({kind: 'invalid', reason: expect.any(String)});
    expect(JSON.stringify(read(cmd, '{secret-marker', getter))).not.toContain('secret-marker');
    expect(read(cmd, schema, getter).kind).toBe('invalid');
    expect(read(cmd, '', getter).kind).toBe(cmd === CtrlCmd.Message ? 'invalid' : 'absent');
});
test('valid metadata preserves SAFE_REVIVER and unexpected native parser failures propagate', () => {
    const result = read(CtrlCmd.Message, '{"type":"sysinfo","payload":{"__proto__":{"bad":1},"constructor":1,"prototype":1,"ok":2}}', 'messageMetaResult');
    expect(result).toEqual({kind: 'valid', value: {type: 'sysinfo', payload: {ok: 2}}});
    const parse = JSON.parse; const fault = new TypeError('owned-native-boundary');
    try { JSON.parse = () => { throw fault; };
        expect(() => read(CtrlCmd.Message, '{}', 'messageMetaResult')).toThrow(fault);
    } finally { JSON.parse = parse; }
});
