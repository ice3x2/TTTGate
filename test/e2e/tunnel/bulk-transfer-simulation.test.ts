import fs from "fs";
import path from "path";
import http from "http";
import crypto from "crypto";
import YAML from "yaml";
import {bigPayloadDigest, startTargetService, TargetService} from "../target/targetService";
import {createProcessTunnelHarness, ProcessTunnelHarness, ProcessTunnelOptions, readRssMiB} from "../../helpers/processTunnelHarness";
import {waitUntil} from "../../helpers/smokeProcess";
import {CONTROL_CERT_SERVER_NAME} from "../../../src/server/CertificationStore";

jest.setTimeout(300_000);

const RSS_LIMIT_MIB = 256;
const sha256 = (data: Buffer): string => crypto.createHash("sha256").update(data).digest("hex");

/** 받은 바이트를 해시만 남기며 읽는다. pause·resume 으로 읽는 속도를 정할 수 있다. */
const download = (port: number, urlPath: string) => {
    const hash = crypto.createHash("sha256");
    let received = 0;
    let response: http.IncomingMessage | undefined;
    let settle!: (value: {status: number, length: number, sha256: string, complete: boolean}) => void;
    const done = new Promise<{status: number, length: number, sha256: string, complete: boolean}>((resolve) => { settle = resolve; });
    const req = http.get({host: "127.0.0.1", port, path: urlPath, agent: false}, (res) => {
        response = res;
        res.on("data", (chunk: Buffer) => { received += chunk.length; hash.update(chunk); });
        const finish = () => settle({status: res.statusCode ?? 0, length: received, sha256: hash.digest("hex"), complete: res.complete});
        res.once("end", finish);
        res.once("close", () => { if(!res.complete) finish(); });
    });
    req.on("error", () => settle({status: 0, length: received, sha256: "", complete: false}));
    return {done, received: () => received, pause: () => response?.pause(), resume: () => response?.resume(),
        started: () => response !== undefined, abort: () => req.destroy()};
};

const upload = (port: number, body: Buffer): Promise<{status: number, sha256: string}> => new Promise((resolve, reject) => {
    const req = http.request({host: "127.0.0.1", port, path: "/echo-post", method: "POST", agent: false,
        headers: {"Content-Type": "application/octet-stream", "Content-Length": String(body.length)}}, (res) => {
        const hash = crypto.createHash("sha256");
        res.on("data", (chunk: Buffer) => hash.update(chunk));
        res.on("end", () => resolve({status: res.statusCode ?? 0, sha256: hash.digest("hex")}));
    });
    req.on("error", reject);
    req.end(body);
});

const cacheFiles = (dirs: string[]): string[] => dirs.flatMap((dir) =>
    fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".cache")).map((name) => path.join(dir, name)) : []);

/** 전송 동안 서버·클라이언트 RSS 의 최대 증가량(MiB). Linux 가 아니면 undefined. */
const rssWatch = (pids: number[]) => {
    const baseline = pids.map((pid) => readRssMiB(pid));
    if(baseline.some((value) => value === undefined)) return {stop: () => undefined as number | undefined};
    let maxGrowth = 0;
    const timer = setInterval(() => pids.forEach((pid, n) => {
        const sample = readRssMiB(pid);
        if(sample !== undefined) maxGrowth = Math.max(maxGrowth, sample - (baseline[n] as number));
    }), 200);
    return {stop: () => { clearInterval(timer); return maxGrowth; }};
};

describe("bulk transfer simulation (process boundary)", () => {
    let target: TargetService;
    let harness: ProcessTunnelHarness;

    afterEach(async () => {
        try { await harness?.dispose(); } finally { await target?.close(); }
    });

    const start = async (extra: Partial<ProcessTunnelOptions> = {}) => {
        target = await startTargetService();
        harness = await createProcessTunnelHarness({tunnels: [{protocol: "http", destinationPort: target.port}], ...extra});
        const port = harness.tunnels[0].forwardPort;
        if(extra.startClient !== false) await harness.waitForTunnelOnline(port);
        return port;
    };
    const cacheDirs = () => [path.join(harness.rootDir, "cache", "server"), ...harness.clientRootDirs.map((dir) => path.join(dir, "cache", "client"))];

    // #237·#240 — 실제 프로세스에서는 읽기를 멈추면 배압이 대상까지 전달되어 버퍼가 디스크 캐시로 넘치지 않는다.
    // (넘친 캐시의 회수는 cache-reclaim.test.ts 가 넘침을 강제해 확인한다.)
    test("#237 a paused external reader backs pressure up to the target instead of spilling to the disk cache", async () => {
        const port = await start({serverOptionExtra: {globalMemCacheLimit: 16}, clientOptionExtra: {globalMemCacheLimit: 16}});
        const transfer = download(port, "/big?mb=96");
        await waitUntil(async () => transfer.started() ? true : undefined, {timeoutMs: 15_000, label: "response started"});
        transfer.pause();
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        expect(cacheFiles(cacheDirs())).toEqual([]);
        expect(transfer.received()).toBeLessThan(96 * 1048576);
        transfer.resume();
        expect(await transfer.done).toMatchObject({status: 200, length: 96 * 1048576, sha256: bigPayloadDigest(96), complete: true});
    });

    // #238 — 동시 대량 전송
    test("#238 four 32MiB downloads and two 32MiB uploads at once all arrive intact within the memory bound", async () => {
        const port = await start();
        const watch = rssWatch([harness.server.child.pid!, harness.clients[0].child.pid!]);
        const body = crypto.randomBytes(32 * 1048576);
        const started = Date.now();
        const [downloads, uploads] = await Promise.all([
            Promise.all(Array.from({length: 4}, () => download(port, "/big?mb=32").done)),
            Promise.all([upload(port, body), upload(port, body)])
        ]);
        const growth = watch.stop();
        for(const result of downloads) expect(result).toMatchObject({status: 200, length: 32 * 1048576, sha256: bigPayloadDigest(32), complete: true});
        for(const result of uploads) expect(result).toEqual({status: 200, sha256: sha256(body)});
        expect(Date.now() - started).toBeLessThan(240_000);
        if(growth !== undefined) expect(growth).toBeLessThanOrEqual(RSS_LIMIT_MIB);
    });

    // #239 — TLS 제어 연결 위의 대량 전송
    test("#239 64MiB down and up stay intact over a verified TLS control connection", async () => {
        const port = await start({serverOptionExtra: {tls: true}, startClient: false});
        // 서버가 만든 제어 인증서를 클라이언트가 CA 로 고정하고 고정 서버 이름으로 검증한다.
        const certPath = path.join(harness.rootDir, "cert", "control.cert.pem");
        await waitUntil(async () => fs.existsSync(certPath) ? true : undefined, {timeoutMs: 20_000, label: "control cert"});
        const yamlPath = path.join(harness.clientRootDirs[0], "config", "client.yaml");
        const clientYaml = YAML.parse(fs.readFileSync(yamlPath, "utf-8"));
        fs.writeFileSync(yamlPath, YAML.stringify({...clientYaml, tls: true, ca: certPath, serverName: CONTROL_CERT_SERVER_NAME, allowInsecureTls: false}));
        await harness.startClient(0);
        await harness.waitForTunnelOnline(port);
        const {json} = await harness.adminRequest("/api/clientStatus");
        expect(json.statuses.map((s: {clientId: string}) => s.clientId)).toContain(harness.clientIds[0]);

        expect(await download(port, "/big?mb=64").done).toMatchObject({status: 200, length: 64 * 1048576, sha256: bigPayloadDigest(64), complete: true});
        const body = crypto.randomBytes(64 * 1048576);
        expect(await upload(port, body)).toEqual({status: 200, sha256: sha256(body)});
        // REQ-2: 전송 뒤에도 터널이 살아 있다.
        expect(await download(port, "/big?mb=1").done).toMatchObject({status: 200, complete: true});
    });

    // #240 — 오래 지속되는 느린 소비자
    test("#240 a slow reader (about 1MiB/s) completes intact, stays within the memory bound and does not block other requests", async () => {
        const port = await start();
        const watch = rssWatch([harness.server.child.pid!, harness.clients[0].child.pid!]);
        const slow = download(port, "/big?mb=32");
        await waitUntil(async () => slow.started() ? true : undefined, {timeoutMs: 15_000, label: "slow response started"});
        // 초당 약 1MiB: 100ms 마다 읽기를 잠깐 열었다 닫는다.
        let allowance = 0;
        const throttle = setInterval(() => {
            allowance += 100 * 1024;
            if(slow.received() < allowance) slow.resume(); else slow.pause();
        }, 100);
        try {
            // REQ-3: 느린 전송 중에도 같은 터널의 다른 요청이 답한다.
            await new Promise((resolve) => setTimeout(resolve, 5_000));
            const other = await download(port, "/big?mb=1").done;
            expect(other).toMatchObject({status: 200, length: 1048576, complete: true});
            const result = await slow.done;
            expect(result).toMatchObject({status: 200, length: 32 * 1048576, sha256: bigPayloadDigest(32), complete: true});
        } finally {
            clearInterval(throttle);
        }
        const growth = watch.stop();
        if(growth !== undefined) expect(growth).toBeLessThanOrEqual(RSS_LIMIT_MIB);
    });
});
