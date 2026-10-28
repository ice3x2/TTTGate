import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import YAML from "yaml";
import {createProcessTunnelHarness, ProcessTunnelHarness} from "../../helpers/processTunnelHarness";
import {generateSelfSignedCert} from "../../helpers/testCerts";
import {waitUntil} from "../../helpers/smokeProcess";

// #280 — 대상 서버가 자체 서명 인증서를 쓰면, 그 터널에서 허용을 켠 경우에만 연결된다.
jest.setTimeout(120_000);

/** 자체 서명 인증서로 응답하는 https 대상 서버. 클라이언트 프로세스는 이 인증서를 신뢰하지 않는다. */
const startSelfSignedServer = (): Promise<{port: number; close: () => Promise<void>}> => {
    const bundle = generateSelfSignedCert("127.0.0.1");
    const server = https.createServer({key: bundle.keyPem, cert: bundle.certPem}, (_req, res) => {
        res.writeHead(200, {"Content-Type": "text/plain"});
        res.end("self-signed-ok");
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            resolve({port: typeof address === "object" && address ? address.port : 0,
                close: () => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); })});
        });
    });
};

/** 외부 포트(자체 서명)로 https 요청을 보내 상태와 본문을, 실패하면 오류를 돌려준다. */
const fetchThrough = (port: number): Promise<{status: number; body: string} | {error: string}> => new Promise((resolve) => {
    const req = https.get({host: "127.0.0.1", port, path: "/", rejectUnauthorized: false, agent: false,
        checkServerIdentity: () => undefined, timeout: 10_000}, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({status: res.statusCode!, body}));
        res.on("error", (error) => resolve({error: error.message}));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => resolve({error: error.message}));
});

describe("self-signed destination certificate", () => {
    let destination: {port: number; close: () => Promise<void>};
    let harness: ProcessTunnelHarness;
    let previousExtraCa: string | undefined;

    beforeAll(async () => {
        // 다른 테스트가 남긴 신뢰 CA 가 있으면 이 테스트의 전제가 무너진다.
        previousExtraCa = process.env.NODE_EXTRA_CA_CERTS;
        delete process.env.NODE_EXTRA_CA_CERTS;
        destination = await startSelfSignedServer();
        harness = await createProcessTunnelHarness({tunnels: [
            {protocol: "https", destinationPort: destination.port, tls: true, extra: {allowSelfSignedDestinationCert: true}},
            {protocol: "https", destinationPort: destination.port, tls: true},
        ]});
        for(const tunnel of harness.tunnels) await harness.waitForTunnelOnline(tunnel.forwardPort);
    });

    afterAll(async () => {
        try { await harness?.dispose(); }
        finally {
            await destination?.close();
            if(previousExtraCa !== undefined) process.env.NODE_EXTRA_CA_CERTS = previousExtraCa;
        }
    });

    test("a tunnel that allows it reaches the self-signed destination (AC-2)", async () => {
        expect(await fetchThrough(harness.tunnels[0].forwardPort)).toEqual({status: 200, body: "self-signed-ok"});
    });

    test("a tunnel that does not allow it still refuses the self-signed destination (AC-2)", async () => {
        // 이 요청 뒤에 쌓인 로그만 본다. 앞 테스트의 로그로 통과하면 안 된다.
        const from = harness.clients[0].stdoutChunks.length;
        const result = await fetchThrough(harness.tunnels[1].forwardPort);
        expect("status" in result && result.status === 200).toBe(false);
        // 다른 이유(연결 안 됨·시간 초과)가 아니라, 클라이언트가 대상 인증서를 거부해서 실패해야 한다.
        const clientLog = () => Buffer.concat(harness.clients[0].stdoutChunks.slice(from)).toString("utf-8");
        await waitUntil(async () => clientLog().includes("self-signed certificate") || undefined, {timeoutMs: 10_000, label: "client rejected the certificate"});
    });

    // 실행 중인 서버에서 저장하면 다시 시작하지 않아도 그 뒤 새 세션부터 반영되고, 설정 파일에도 남는다(REQ-6, AC-3).
    test("turning the option on through the admin API applies to new sessions without a restart (REQ-6)", async () => {
        const port = harness.tunnels[1].forwardPort;
        const list = await harness.adminRequest("/api/tunnelingOption");
        expect(list.status).toBe(200);
        const {ownerId: _ownerId, owner: _owner, editable: _editable, ...stored} = list.json.tunnelingOptions.find((row: any) => row.forwardPort === port);
        const saved = await harness.adminRequest("/api/tunnelingOption", {method: "POST",
            body: {...stored, allowSelfSignedDestinationCert: true, expectedRevision: list.json.revisionState.currentRevision}});
        expect(saved.status).toBe(200);

        const after = await harness.adminRequest("/api/tunnelingOption");
        expect(after.json.tunnelingOptions.find((row: any) => row.forwardPort === port).allowSelfSignedDestinationCert).toBe(true);
        const yaml = YAML.parse(fs.readFileSync(path.join(harness.rootDir, "config", "server.yaml"), "utf-8"));
        expect(yaml.tunnelingOptions.find((row: any) => row.forwardPort === port).allowSelfSignedDestinationCert).toBe(true);
        expect(await fetchThrough(port)).toEqual({status: 200, body: "self-signed-ok"});
    });
});
