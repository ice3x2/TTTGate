import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import Environment from '../../src/Environment';
import ServerOptionStore from '../../src/server/ServerOptionStore';
import ServerApp from '../../src/server/ServerApp';
import AdminServer from '../../src/server/admin/AdminServer';
import TTTServer from '../../src/server/TTTServer';
import {CertificationStore} from '../../src/server/CertificationStore';

const root = process.argv[2];
Environment.configure({rootDir: root});
const facts: any = {pid: process.pid, certLoads: 0, adminListens: 0, tunnelStarts: 0};
process.on('exit', () => fs.writeFileSync(path.join(root, 'facts.json'), JSON.stringify(facts)));
const load = CertificationStore.prototype.load, listen = AdminServer.prototype.listen, start = TTTServer.prototype.start;
let admin: AdminServer | undefined, tunnel: TTTServer | undefined;
CertificationStore.prototype.load = async function() { facts.certLoads++; return load.call(this); };
AdminServer.prototype.listen = async function(...args) { admin = this; const port = await listen.apply(this, args); facts.adminListens++; return port; };
TTTServer.prototype.start = async function() { tunnel = this; await start.call(this); facts.tunnelStarts++; };
async function run() {
    try {
        const store = ServerOptionStore.instance;
        const read = store.readServerOption(); facts.ready = read.success;
        await ServerApp.start({allowLegacyAdminHttp: 'true'});
        if(read.success) {
            facts.buffer = store.serverOption.tunnelingOptions[0].bufferLimitOnServer;
            const socket = net.createConnection({host: '127.0.0.1', port: store.serverOption.port});
            await new Promise<void>((resolve, reject) => { socket.once('connect', () => { facts.connected = true; socket.destroy(); resolve(); }); socket.once('error', reject); });
        }
    } finally {
        await admin?.close(); await tunnel?.close();
        CertificationStore.prototype.load = load; AdminServer.prototype.listen = listen; TTTServer.prototype.start = start;
    }
}
run().catch(error => { facts.error = String(error); process.exitCode = 1; });
