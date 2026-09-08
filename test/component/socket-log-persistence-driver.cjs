// Real socket events and production logger configuration with ignored stdio.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {once} = require('node:events');
const root = process.argv[2];
const Environment = require('../../src/Environment').default;
const AppCompositionRoot = require('../../src/bootstrap/AppCompositionRoot').default;
const LoggerFactory = require('../../src/util/logger/LoggerFactory').default;
const {LoggerConfig} = require('../../src/util/logger/LoggerConfig');
const {SocketHandler} = require('../../src/util/SocketHandler');
const {TCPServer} = require('../../src/util/TCPServer');

const facts = {pid: process.pid, timeoutObserved: false, ownerCalls: 0, bindError: null};
const sockets = [];
const listener = net.createServer();
const occupied = net.createServer();
let handler, conflict;
const bounded = async operation => {
    let timer;
    try {
        return await Promise.race([operation, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Socket logging event timeout')), 5000);
        })]);
    } finally { clearTimeout(timer); }
};

async function main() {
    fs.mkdirSync(path.join(root, 'logs'), {recursive: true});
    Environment.configure({rootDir: root});
    AppCompositionRoot.configureLogger();
    try {
        let ownerEnded;
        const terminal = new Promise(resolve => { ownerEnded = resolve; });
        listener.once('connection', socket => {
            sockets.push(socket);
            socket.once('timeout', () => { facts.timeoutObserved = true; });
            handler = SocketHandler.bound({socket, port: listener.address().port, addr: '127.0.0.1', tls: false, keepAlive: 0},
                () => {}, () => { facts.ownerCalls++; ownerEnded(); });
            handler.setTimeout(80);
        });
        listener.listen(0, '127.0.0.1');
        await bounded(once(listener, 'listening'));
        const peer = net.createConnection({host: '127.0.0.1', port: listener.address().port});
        sockets.push(peer);
        await bounded(once(peer, 'connect'));
        await bounded(terminal);

        occupied.listen(0);
        await bounded(once(occupied, 'listening'));
        conflict = TCPServer.create({port: occupied.address().port, tls: false, keepAlive: 0});
        await bounded(new Promise(resolve => conflict.start(error => {
            facts.bindError = error?.code ?? null;
            resolve();
        })));
        LoggerFactory.getLogger('server', 'SocketLogControl').info('issue22-real-file-control');
    } finally {
        handler?.destroy();
        sockets.forEach(socket => socket.destroy());
        if(conflict && !conflict.isEnd()) await bounded(new Promise(resolve => conflict.stop(() => resolve())));
        await Promise.all([listener, occupied].filter(server => server.listening)
            .map(server => new Promise(resolve => server.close(() => resolve()))));
        // Existing replacement closes real write streams; no synthetic flush/exit.
        LoggerFactory.updateConfig(LoggerConfig.create(path.join(root, 'logs')));
    }
}

main().catch(error => { facts.failure = error.message; process.exitCode = 1; })
    .finally(() => fs.writeFileSync(path.join(root, 'events.json'), JSON.stringify(facts, null, 2)));
