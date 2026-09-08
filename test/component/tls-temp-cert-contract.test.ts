import tls from 'node:tls';
import net from 'node:net';
import {once} from 'node:events';
import {X509Certificate} from 'node:crypto';
import {lstatSync, realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {CertificationStore} from '../../src/server/CertificationStore';
import {createTestRoot, applyTestRoot, cleanupTestRoot} from '../helpers/runtime';
import {generateSelfSignedCert} from '../helpers/testCerts';

jest.setTimeout(30_000);

test.each(['default-CN-rejection', 'localhost-SAN-echo'] as const)('native TLS certificate fixture %s', async mode => {
    const started = Date.now();
    const root = await createTestRoot('tls47-native');
    const ownedRoot = realpathSync(root.rootDir);
    const sockets = new Set<net.Socket>();
    const serverBytes: Buffer[] = [], clientBytes: Buffer[] = [];
    let server: tls.Server | undefined, client: tls.TLSSocket | undefined;
    let timeout: NodeJS.Timeout | undefined;
    const facts: Record<string, unknown> = {root: ownedRoot, mode};
    const marker = Buffer.from('owned-temp-cert-TLS47-echo');
    try {
        applyTestRoot(root.rootDir);
        const generation = Date.now();
        const store = CertificationStore.instance;
        const original = store.makeTempCert;
        try {
            if(mode === 'localhost-SAN-echo') {
                const generated = generateSelfSignedCert('localhost');
                // Certificate-input fixture only: load publishes a real generated certificate through its original path.
                store.makeTempCert = async () => ({cert: {name: 'owned-localhost.pem', value: generated.certPem},
                    key: {name: 'owned-localhost.key', value: generated.keyPem}, ca: {name: '', value: ''}});
            }
            await store.load();
        } finally { store.makeTempCert = original; }
        facts.generationMs = Date.now() - generation;
        const certificate = CertificationStore.instance.getTempCert();
        const x509 = new X509Certificate(certificate.cert.value);
        const commonName = x509.subject.split('\n').find(line => line.startsWith('CN='))?.slice(3);
        facts.commonName = commonName;
        expect(commonName).toBe(mode === 'default-CN-rejection' ? 'Testing CA - DO NOT TRUST' : 'localhost');
        if(mode === 'localhost-SAN-echo') {
            expect(x509.subjectAltName).toContain('DNS:localhost');
            expect(x509.subjectAltName).toContain('IP Address:127.0.0.1');
        }
        let serverSecure = 0, clientSecure = 0;
        server = tls.createServer({key: certificate.key.value, cert: certificate.cert.value}, socket => {
            sockets.add(socket); serverSecure++;
            socket.on('error', () => {});
            socket.on('data', bytes => {
                serverBytes.push(Buffer.from(bytes));
                if(Buffer.concat(serverBytes).length >= marker.length) socket.end(Buffer.concat(serverBytes));
            });
        });
        server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); });
        server.on('tlsClientError', error => { facts.serverTlsError = error.message; });
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const exchange = new Promise<void>((finish, reject) => {
            timeout = setTimeout(() => reject(new Error('Owned native TLS exchange deadline exceeded')), 10_000);
            client = tls.connect({host: '127.0.0.1', port: (server!.address() as net.AddressInfo).port,
                ca: certificate.cert.value, servername: commonName, rejectUnauthorized: true});
            sockets.add(client);
            client.once('error', error => { facts.errorCode = (error as NodeJS.ErrnoException).code; reject(error); });
            client.once('secureConnect', () => {
                clientSecure++;
                facts.authorized = client!.authorized;
                if(!client!.authorized) { reject(new Error('Native TLS was not authorized')); return; }
                client!.write(marker);
            });
            client.on('data', bytes => clientBytes.push(Buffer.from(bytes)));
            client.once('end', finish);
            client.once('close', () => { if(!client!.readableEnded) reject(new Error('TLS closed before finite response end')); });
        });
        if(mode === 'default-CN-rejection') {
            await expect(exchange).rejects.toMatchObject({code: 'ERR_TLS_CERT_ALTNAME_INVALID'});
            expect(clientSecure).toBe(0); expect(client!.authorized).toBe(false);
            expect(serverBytes).toHaveLength(0); expect(clientBytes).toHaveLength(0);
        } else {
            await exchange;
            expect(clientSecure).toBe(1); expect(serverSecure).toBe(1);
            expect(client!.authorized).toBe(true);
            expect(Buffer.concat(clientBytes)).toEqual(marker); expect(Buffer.concat(serverBytes)).toEqual(marker);
        }
        facts.clientSecure = clientSecure; facts.serverSecure = serverSecure;
        facts.authorized = client!.authorized;
        facts.clientBytes = Buffer.concat(clientBytes).length; facts.serverBytes = Buffer.concat(serverBytes).length;
        facts.passed = true;
    } catch(error) { facts.failure = String(error); throw error; }
    finally {
        if(timeout) clearTimeout(timeout);
        sockets.forEach(socket => socket.destroy());
        if(server?.listening) await new Promise<void>((done, reject) => server!.close(error => error ? reject(error) : done()));
        expect(lstatSync(root.rootDir).isSymbolicLink()).toBe(false);
        expect(realpathSync(root.rootDir)).toBe(ownedRoot);
        expect(resolve(root.rootDir)).toBe(ownedRoot);
        await cleanupTestRoot(root);
        facts.cleaned = true; facts.elapsedMs = Date.now() - started;
        process.stdout.write(`TLS47 facts ${JSON.stringify(facts)}\n`);
    }
});
