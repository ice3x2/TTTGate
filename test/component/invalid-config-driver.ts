import fs from 'fs';
import net from 'net';
import YAML from 'yaml';
import Files from '../../src/util/Files';
import TTTServer from '../../src/server/TTTServer';
import AdminServer from '../../src/server/admin/AdminServer';
import path from 'path';
import Environment from '../../src/Environment';
import ServerOptionStore from '../../src/server/ServerOptionStore';
import ServerApp from '../../src/server/ServerApp';
import {CertificationStore} from '../../src/server/CertificationStore';

const [root, mode] = process.argv.slice(2);
Environment.configure({rootDir: root});
const facts: any = {certLoad: 0, getter: 0};
process.on('exit', () => fs.writeFileSync(path.join(root, 'facts.json'), JSON.stringify(facts)));
if(mode === 'valid-start' || mode === 'reset-start') {
    const run = async () => {
        const reserve = async () => {
            const listener = net.createServer();
            await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
            const port = (listener.address() as net.AddressInfo).port;
            await new Promise<void>(resolve => listener.close(() => resolve())); return port;
        };
        const controlPort = await reserve(), adminPort = await reserve();
        const defaults = (ServerOptionStore.prototype as any).makeDefaultOption;
        // Declared port routing only; actual default generation/start/listen still execute.
        (ServerOptionStore.prototype as any).makeDefaultOption = function() { return {...defaults.call(this), port: controlPort, adminPort, tls: false, adminTls: false}; };
        if(mode === 'valid-start') {
            const file = path.join(root, 'config/server.yaml');
            const option = YAML.parse(fs.readFileSync(file, 'utf8'));
            fs.writeFileSync(file, YAML.stringify({...option, port: controlPort, adminPort, adminBindHost: '127.0.0.1'}));
        }
        const load = CertificationStore.prototype.load, listen = AdminServer.prototype.listen, start = TTTServer.prototype.start;
        let admin: AdminServer | undefined, tunnel: TTTServer | undefined;
        CertificationStore.prototype.load = async function() { facts.certLoad++; return load.call(this); };
        AdminServer.prototype.listen = async function(...args: any[]) { admin = this; const result = await (listen as any).apply(this, args); facts.adminListening = (this as any)._server.listening; return result; };
        TTTServer.prototype.start = async function() { tunnel = this; await start.call(this); facts.controlStarted = true; };
        try {
            await ServerApp.start({allowLegacyAdminHttp: 'true', keepAlive: '23456', adminPort: String(adminPort), ...(mode === 'reset-start' ? {reset: 'true'} : {})});
            facts.keepAlive = ServerOptionStore.instance.serverOption.keepAlive;
            const socket = net.createConnection({host: '127.0.0.1', port: controlPort}); socket.on('error', () => {});
            await new Promise<void>((resolve, reject) => { socket.once('connect', () => { facts.controlConnected = true; socket.destroy(); resolve(); }); socket.once('error', reject); });
        } finally {
            await admin?.close(); await tunnel?.close();
            facts.closed = true;
            CertificationStore.prototype.load = load; AdminServer.prototype.listen = listen; TTTServer.prototype.start = start;
            (ServerOptionStore.prototype as any).makeDefaultOption = defaults;
        }
    };
    run().catch(error => { facts.error = String(error); process.exitCode = 1; });
} else if(mode === 'startup') {
    const descriptor = Object.getOwnPropertyDescriptor(ServerOptionStore.prototype, 'serverOption')!;
    Object.defineProperty(ServerOptionStore.prototype, 'serverOption', {...descriptor, get() { facts.getter++; return descriptor.get!.call(this); }});
    // Declared entry barrier: baseline must never proceed beyond this point. No cert/listener fake success.
    CertificationStore.prototype.load = async () => { facts.certLoad++; throw new Error('owned-cert-load-boundary'); };
    ServerApp.start({adminPort: '12345'}).catch(error => { facts.error = String(error); process.exitCode = 1; });
} else {
    const read = fs.readFileSync, batch = Files.writeAtomicBatchSync;
    if(mode === 'bootstrap-write-error') Files.writeAtomicBatchSync = () => { throw new Error('owned-bootstrap-write-fault'); };
    if(mode === 'read-error') (fs as any).readFileSync = function(file: any, ...args: any[]) {
        if(String(file) === path.join(root, 'config/server.yaml')) throw Object.assign(new Error('owned read fault'), {code: 'EACCES'});
        return (read as any)(file, ...args);
    };
    try {
        const store: any = ServerOptionStore.instance;
        facts.status = store.loadStatus ?? {ready: true, source: 'baseline-api-absent'}; facts.option = store.readServerOption?.() ?? {success: true, serverOption: store.serverOption};
    } catch(error) { facts.error = String(error); process.exitCode = 1; }
    finally { fs.readFileSync = read; Files.writeAtomicBatchSync = batch; }
}
