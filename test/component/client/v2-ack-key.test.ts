import TTTClient from '../../../src/client/TTTClient';
import {CtrlPacket} from '../../../src/commons/CtrlPacket';
import {DEFAULT_KEY} from '../../../src/types/TunnelingOption';
import {withLegacyIds, until} from '../server/legacy-handler-id-fixture';

jest.setTimeout(30_000);

// #161 — v2 핸드셰이크는 HMAC 증명으로 인증한다. legacy 공유 키를 AckCtrl 에 실으면 평문 연결이나 허위 서버에 키가 새고,
// 그 키로 allowLegacyControlAuth 서버에 legacy 클라이언트로 붙을 수 있다.
test('v2 client sends an empty legacy key in AckCtrl and still authenticates', async () => withLegacyIds(async f => {
    const server = f.server.tunnelServer as any;
    const keys: string[] = [];
    const original = CtrlPacket.createAckCtrl;
    const spy = jest.spyOn(CtrlPacket, 'createAckCtrl').mockImplementation((id, name, key, v2) => {
        keys.push(key);
        return original.call(CtrlPacket, id, name, key, v2);
    });
    const client = TTTClient.create({host: '127.0.0.1', port: server.port, tls: false, key: DEFAULT_KEY,
        name: 'wide', clientId: 'wide', clientSecret: 'fixture-wide-secret', allowLegacyFallback: false, keepAlive: 0, globalMemCacheLimit: 128});
    try {
        client.start();
        await until(() => (client as any)._isOnline, 'v2 client did not authenticate');
        expect(keys).toEqual(['']);
    } finally {
        client.stop();
        spy.mockRestore();
    }
}));
