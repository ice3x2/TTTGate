import {createTunnelHarness} from '../../helpers/tunnelHarness';
import {until} from './legacy-handler-id-fixture';

// #338 REQ-6 — 상태 API 의 clientConnected. 세션을 열 때 클라이언트를 고르는 규칙과 같은 함수로 판정한다.
jest.setTimeout(60_000);

const connectedOf = (h: any): Record<number, boolean> =>
    Object.fromEntries(h.getServer().externalServerStatuses().map((status: any) => [status.port, status.clientConnected]));

test('each tunnel reports whether a client allowed to serve it is connected', async () => {
    const h = await createTunnelHarness({clients: [{clientId: 'A', clientSecret: 'owned-A'}, {clientId: 'B', clientSecret: 'owned-B'}]} as any);
    try {
        await h.start();
        const [portA, portB] = h.clients.map((client: any) => client.forwardPort);
        expect(connectedOf(h)).toMatchObject({[portA]: true, [portB]: true});

        await h.stopClient('A');
        await until(() => connectedOf(h)[portA] === false, 'client A did not disconnect');
        expect(connectedOf(h)).toMatchObject({[portA]: false, [portB]: true});
    } finally {
        await h.dispose();
    }
});
