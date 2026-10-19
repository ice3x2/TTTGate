// Explicit Windows artifact probe, run after packaging; ordinary Jest does not build binaries.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const {spawn, spawnSync} = require('node:child_process');
const archive = path.resolve(process.argv[2]);
const report = path.resolve(process.argv[3]);
const freePort = () => new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const request = (port, url) => new Promise(resolve => {
    const req = http.get({host: '127.0.0.1', port, path: url, timeout: 1000}, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({status: response.statusCode, body: Buffer.concat(chunks)}));
    });
    req.on('error', () => resolve(null)); req.on('timeout', () => req.destroy());
});
const main = async () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'tttgate-binary69-'));
    const extracted = path.join(outer, 'extract'); fs.mkdirSync(extracted);
    const extraction = spawnSync('tar', ['-xf', archive, '-C', extracted], {encoding: 'utf8'});
    if(extraction.status !== 0) throw new Error(extraction.stderr);
    const nested = path.join(extracted, 'bin/TTTGate-win-x64.exe');
    const executable = fs.existsSync(nested) ? nested : path.join(extracted, 'TTTGate-win-x64.exe');
    // The old flat archive is deliberately executable here to reproduce its real failure.
    const runtimeRoot = path.resolve(executable, '../..');
    const adminPort = await freePort(), controlPort = await freePort();
    fs.mkdirSync(path.join(runtimeRoot, 'config'), {recursive: true});
    fs.writeFileSync(path.join(runtimeRoot, 'config/server.yaml'), JSON.stringify({
        key: `srv-${crypto.randomBytes(16).toString('hex')}`, adminPort, port: controlPort,
        adminBindHost: '127.0.0.1', adminTls: false, tls: false, controlProtocolMode: 'mixed',
        allowLegacyControlAuth: false, trustedClients: [], tunnelingOptions: [], keepAlive: 0,
    }));
    const child = spawn(executable, ['server', '-allowLegacyAdminHttp'], {cwd: extracted, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', exited = false, childExit;
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
    const exit = new Promise(resolve => {
        child.once('error', error => { output += error.message; exited = true; resolve(); });
        child.once('exit', (code, signal) => { exited = true; childExit = {code, signal}; resolve(); });
    });
    const facts = {archive, outer, extracted, executable, runtimeRoot, adminPort, controlPort, pid: child.pid, pass: false};
    try {
        let page; const deadline = Date.now() + 15000;
        while(Date.now() < deadline && !exited) {
            page = await request(adminPort, '/'); if(page) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if(!page || page.status !== 200) throw new Error(`Native admin HTTP failed: ${page?.status ?? 'no response'}`);
        if(!page.body.equals(fs.readFileSync(path.join(runtimeRoot, 'web/index.html')))) throw new Error('HTML mismatch');
        const assets = [...page.body.toString().matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
        if(assets.length === 0) throw new Error('No production assets');
        facts.assets = [];
        for(const asset of assets) {
            const response = await request(adminPort, asset);
            if(!response || response.status !== 200 || !response.body.equals(fs.readFileSync(path.join(runtimeRoot, 'web', asset)))) throw new Error(`Asset mismatch: ${asset}`);
            facts.assets.push({path: asset, status: response.status, bytes: response.body.length, sha256: crypto.createHash('sha256').update(response.body).digest('hex')});
        }
        facts.pidFileExists = fs.existsSync(path.join(runtimeRoot, 'bin/.pid_foreground'));
        if(!facts.pidFileExists) throw new Error('Runtime PID file missing');
        facts.htmlStatus = page.status; facts.pass = true;
    } catch(error) { facts.failure = error.message; process.exitCode = 1; }
    finally {
        if(!exited) child.kill(); await exit;
        facts.childExit = childExit;
        fs.writeFileSync(report, JSON.stringify(facts, null, 2) + '\n');
        fs.writeFileSync(report + '.log', output);
        console.log(JSON.stringify(facts, null, 2));
    }
};
main().catch(error => { console.error(error.message); process.exitCode = 1; });
