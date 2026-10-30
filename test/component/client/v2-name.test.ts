import TTTClient from '../../../src/client/TTTClient';
import {CtrlPacket} from '../../../src/commons/CtrlPacket';
import {DEFAULT_KEY} from '../../../src/types/TunnelingOption';
import {withLegacyIds, until} from '../server/legacy-handler-id-fixture';

jest.setTimeout(30_000);

// #210 — 클라이언트는 -name 하나만 이름으로 보낸다. v2 서버는 그 이름이 아니라 서버에 등록된 표시 이름을 쓴다(#162).
test('a v2 client sends -name, and the server still shows its registered name', async () => withLegacyIds(async f => {
    const server = f.server.tunnelServer as any;
    const sent: Array<{name: string, displayName?: string}> = [];
    const original = CtrlPacket.createAckCtrl;
    const spy = jest.spyOn(CtrlPacket, 'createAckCtrl').mockImplementation((id, name, key, v2) => {
        sent.push({name, displayName: v2?.displayName});
        return original.call(CtrlPacket, id, name, key, v2);
    });
    const client = TTTClient.create({host: '127.0.0.1', port: server.port, tls: false, key: DEFAULT_KEY,
        name: 'officeA', displayName: 'claimed-other', clientId: 'wide', clientSecret: 'fixture-wide-secret',
        allowLegacyFallback: false, keepAlive: 0, globalMemCacheLimit: 128});
    try {
        client.start();
        await until(() => (client as any)._isOnline, 'v2 client did not authenticate');
        expect(sent).toEqual([{name: 'officeA', displayName: 'officeA'}]);
        await until(() => f.server.clientStatus().length > 0, 'server did not register the client');
        expect(f.server.clientStatus().map((status: {name: string}) => status.name)).toContain('wide');
        expect(f.server.clientStatus().map((status: {name: string}) => status.name)).not.toContain('officeA');
    } finally {
        client.stop();
        spy.mockRestore();
    }
}));
