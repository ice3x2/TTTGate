import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import {once} from 'node:events';
import {withConfigurationServer} from './configuration-revision-fixture';
import {getFreePort} from '../../../helpers/network';
import {createTunnelHarness} from '../../../helpers/tunnelHarness';
import {generateSelfSignedCert} from '../../../helpers/testCerts';
import {CertificationStore} from '../../../../src/server/CertificationStore';

jest.setTimeout(60000);
const files = (root: string) => {
    const result: Record<string, string> = {};
    const read = (dir: string) => { for(const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const file = path.join(dir, entry.name);
        if(entry.isDirectory()) read(file); else result[path.relative(root, file)] = fs.readFileSync(file).toString('base64');
    }};
    read(path.join(root, 'config')); read(path.join(root, 'cert')); return result;
};

test('ordinary and nested APIs reject server buffers before files, revisions or listeners change', async () => withConfigurationServer(async f => {
    const port = await getFreePort();
    const option = {forwardPort: port, protocol: 'tcp', destinationAddress: '127.0.0.1', destinationPort: 9, keepAlive: 0, bufferLimitOnServer: 1.5, bufferLimitOnClient: -1};
    expect((await f.request('POST', '/api/tunnelingOption', {...option, expectedRevision: f.store.revisionState.currentRevision})).statusCode).toBe(200);
    const before = files(f.root.rootDir), config = f.store.serverOption, revision = f.store.revisionState;
    const listener = f.tunnel._externalPortServerPool._portServerMap.get(port), runtime = f.tunnel.captureRuntimeState();
    for(const value of [0, -1, 0.5, null, '1', false, {}, []]) {
        for(const method of ['POST', 'PUT']) {
            expect((await f.request(method, '/api/tunnelingOption', {...option, bufferLimitOnServer: value, expectedRevision: revision.currentRevision})).statusCode).toBe(400);
            expect((await f.request(method, '/api/serverOption', {...config, tunnelingOptions: [{...option, bufferLimitOnServer: value}], expectedRevision: revision.currentRevision})).statusCode).toBe(400);
        }
        expect(files(f.root.rootDir)).toEqual(before); expect(f.store.serverOption).toEqual(config); expect(f.store.revisionState).toEqual(revision);
        expect(f.tunnel._externalPortServerPool._portServerMap.get(port)).toBe(listener);
        expect(f.tunnel.captureRuntimeState().scopes).toEqual(runtime.scopes);
        expect(f.tunnel.externalServerStatus(port).online).toBe(true);
    }
    expect((await f.request('POST', '/api/tunnelingOption', {...option, bufferLimitOnClient: 0, expectedRevision: revision.currentRevision})).statusCode).toBe(200);
}));

test('invalid compound TLS rename retains exact certificate bytes and native fingerprint', async () => withConfigurationServer(async f => {
    const bundle = generateSelfSignedCert('buffer40-old'), replacement = generateSelfSignedCert('buffer40-next');
    const cert = (value: typeof bundle, name: string) => ({key: {name: `${name}.key`, value: value.keyPem}, cert: {name: `${name}.pem`, value: value.certPem}, ca: {name: '', value: ''}});
    const port = await getFreePort(), nextPort = await getFreePort();
    const option = {forwardPort: port, protocol: 'tcp', destinationAddress: '127.0.0.1', destinationPort: 9, tls: true, keepAlive: 0, bufferLimitOnServer: 1.5};
    expect((await f.request('POST', '/api/tunnelingOption', {...option, certInfo: cert(bundle, 'old'), expectedRevision: f.store.revisionState.currentRevision,
        expectedCertificateRevision: CertificationStore.instance.revisionState.currentRevision})).statusCode).toBe(200);
    const fingerprint = () => new Promise<string>((resolve, reject) => {
        const socket = tls.connect({host: '127.0.0.1', port, rejectUnauthorized: false});
        socket.setTimeout(3000, () => socket.destroy(new Error('Owned fingerprint timeout')));
        socket.once('error', reject); socket.once('secureConnect', () => { const value = socket.getPeerCertificate().fingerprint256; socket.destroy(); resolve(value); });
    });
    const before = files(f.root.rootDir), identity = await fingerprint();
    const revision = f.store.revisionState, certificateRevision = CertificationStore.instance.revisionState;
    const listener = f.tunnel._externalPortServerPool._portServerMap.get(port);
    expect((await f.request('POST', '/api/tunnelingOption', {...option, forwardPort: nextPort, previousForwardPort: port, bufferLimitOnServer: 0,
        certInfo: cert(replacement, 'new'), expectedRevision: revision.currentRevision, expectedCertificateRevision: certificateRevision.currentRevision})).statusCode).toBe(400);
    expect(files(f.root.rootDir)).toEqual(before); expect(f.store.revisionState).toEqual(revision);
    expect(CertificationStore.instance.revisionState).toEqual(certificateRevision);
    expect(f.tunnel._externalPortServerPool._portServerMap.get(port)).toBe(listener); expect(await fingerprint()).toBe(identity);
    expect((await f.request('POST', '/api/tunnelingOption', {...option, forwardPort: nextPort, previousForwardPort: port, certInfo: cert(replacement, 'new'),
        expectedRevision: revision.currentRevision, expectedCertificateRevision: certificateRevision.currentRevision})).statusCode).toBe(200);
}));

test('accepted fractional server buffer reaches actual tunnel handler and exact echo', async () => {
    const harness = await createTunnelHarness({clients: [{clientId: 'buffer40', clientSecret: 'owned-buffer-secret',
        tunnelingOptionOverride: {bufferLimitOnServer: 1.5, bufferLimitOnClient: -1}}]});
    let socket: net.Socket | undefined;
    try {
        await harness.start();
        socket = net.createConnection({host: '127.0.0.1', port: harness.forwardPort});
        socket.on('error', () => {}); const received = once(socket, 'data');
        await once(socket, 'connect'); socket.write('fractional-buffer-echo');
        expect((await received)[0]).toEqual(Buffer.from('fractional-buffer-echo'));
        const pool = (harness.getServer() as any)._externalPortServerPool;
        const handlers = [...pool._handlerMap.values()] as any[];
        expect(handlers).toHaveLength(1); expect(handlers[0].bufferSizeLimit).toBe(1.5 * 1048576);
    } finally { socket?.destroy(); await harness.dispose(); }
});
