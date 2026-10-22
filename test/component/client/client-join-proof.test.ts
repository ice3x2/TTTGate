import * as fs from "fs";
import * as path from "path";
import tls from "tls";
import net from "net";
import {once} from "events";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer} from "../../../src/commons/CtrlPacket";
import {deriveEnrollmentKeys, sealEnrollmentPayload} from "../../../src/commons/Enrollment";
import {EnrollResponseMeta} from "../../../src/commons/ProtocolV2";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import TTTServer from "../../../src/server/TTTServer";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {runClientJoin} from "../../../src/client/ClientJoin";
import {getFreePort} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";
import {generateSelfSignedCert} from "../../helpers/testCerts";

jest.setTimeout(60_000);

const CODE = "7Q4K-M2XP-AB01";

/** 등록 요청을 받으면 answer 가 만든 바이트로 답하는 가짜 TLS 서버. */
const startFakeServer = async (answer: (lookup: string) => Promise<Buffer>) => {
    const cert = generateSelfSignedCert("localhost");
    const sockets = new Set<net.Socket>();
    const server = tls.createServer({key: cert.keyPem, cert: cert.certPem}, (socket) => {
        sockets.add(socket);
        socket.on("error", () => {});
        const streamer = new CtrlPacketStreamer();
        socket.on("data", async (chunk) => {
            const packet = streamer.readCtrlPacketList(chunk).find((p) => p.cmd === CtrlCmd.EnrollRequest);
            const meta = packet?.enrollRequestMetaResult;
            if(meta?.kind === "valid") socket.end(await answer(meta.value.lookup));
        });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {port: (server.address() as net.AddressInfo).port, certPem: cert.certPem,
        close: () => new Promise<void>((resolve) => { sockets.forEach((s) => s.destroy()); server.close(() => resolve()); })};
};

const response = (meta: EnrollResponseMeta): Buffer => CtrlPacket.createEnrollResponse(meta).toBuffer();

// #219 — client join 의 서버 증명 실패(중간자) 거부. 어떤 경우에도 설정 파일을 쓰지 않는다.
describe("client join refuses an unproven server (#219)", () => {
    let root: TestRoot;
    let configDir: string;
    let err: string[];
    const closers: Array<() => Promise<void>> = [];

    beforeEach(async () => {
        root = await createTestRoot("join-proof");
        applyTestRoot(root.rootDir);
        configDir = path.join(root.rootDir, "client-config");
        fs.mkdirSync(configDir);
        err = [];
    });
    afterEach(async () => {
        for(const close of closers.splice(0).reverse()) await close();
        await cleanupTestRoot(root);
    });

    const join = (port: number) => runClientJoin(`127.0.0.1:${port}`, {code: CODE}, {configDir, out: () => {}, err: (line) => err.push(line)});

    test("REQ-1 an answer sealed with another code is refused as a man-in-the-middle", async () => {
        const fake = await startFakeServer(async () => {
            const other = await deriveEnrollmentKeys("0000-0000-0000");
            return response({ok: true, ...sealEnrollmentPayload(other, {clientId: "x", clientSecret: "s", serverName: "n", tls: true, ca: "pem"})});
        });
        closers.push(fake.close);
        expect(await join(fake.port)).toBe(1);
        expect(err.join("\n")).toContain("man-in-the-middle");
        expect(fs.readdirSync(configDir)).toEqual([]);
    });

    test("REQ-1 a correctly sealed answer whose CA is not the server certificate is refused", async () => {
        // 코드를 아는 서버가 다른 인증서를 담아 보내도 받지 않는다(응답 CA 와 TLS 피어 인증서 대조).
        const elsewhere = generateSelfSignedCert("elsewhere");
        const fake = await startFakeServer(async () => {
            const keys = await deriveEnrollmentKeys(CODE);
            return response({ok: true, ...sealEnrollmentPayload(keys, {clientId: "edge", clientSecret: "s3cret", serverName: "tttgate-control", tls: true, ca: elsewhere.certPem})});
        });
        closers.push(fake.close);
        expect(await join(fake.port)).toBe(1);
        expect(err.join("\n")).toContain("man-in-the-middle");
        expect(fs.readdirSync(configDir)).toEqual([]);
    });

    test("REQ-1 a correctly sealed answer from the real certificate but without the client secret is refused", async () => {
        // 봉인 내용 검증(clientId·clientSecret·serverName·tls·CA)을 인증서 대조와 따로 확인한다.
        let certPem = "";
        const fake = await startFakeServer(async () => {
            const keys = await deriveEnrollmentKeys(CODE);
            return response({ok: true, ...sealEnrollmentPayload(keys, {clientId: "edge", serverName: "tttgate-control", tls: true, ca: certPem})});
        });
        certPem = fake.certPem;
        closers.push(fake.close);
        expect(await join(fake.port)).toBe(1);
        expect(err.join("\n")).toContain("man-in-the-middle");
        expect(fs.readdirSync(configDir)).toEqual([]);
    });

    test("REQ-2 a relay that terminates TLS with its own certificate is refused even though the seal is genuine", async () => {
        await CertificationStore.instance.load();
        const realPort = await getFreePort();
        const option: ServerOption = {key: DEFAULT_KEY, adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port: realPort, tls: true,
            controlProtocolMode: "mixed", trustedClients: [{clientId: "edge", clientSecret: "edge-secret-value"}], tunnelingOptions: [], keepAlive: 0, globalMemCacheLimit: 128};
        if(!ServerOptionStore.instance.updateServerOption(option)) throw new Error("bad fixture");
        const server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
        closers.push(() => server.close());
        const issued = await server.issueEnrollmentCode("edge");
        if(!issued.ok) throw new Error(issued.reason);

        // 중계 프록시: 자기 인증서로 TLS 를 끝내고, 진짜 서버에 TLS 로 이어 바이트를 그대로 넘긴다.
        const mitm = generateSelfSignedCert("localhost");
        const sockets = new Set<net.Socket>();
        const relay = tls.createServer({key: mitm.keyPem, cert: mitm.certPem}, (inbound) => {
            const outbound = tls.connect({host: "127.0.0.1", port: realPort, rejectUnauthorized: false});
            sockets.add(inbound); sockets.add(outbound);
            inbound.on("error", () => {}); outbound.on("error", () => {});
            inbound.pipe(outbound).pipe(inbound);
        });
        relay.listen(0, "127.0.0.1");
        await once(relay, "listening");
        closers.push(() => new Promise<void>((resolve) => { sockets.forEach((s) => s.destroy()); relay.close(() => resolve()); }));

        const code = await runClientJoin(`127.0.0.1:${(relay.address() as net.AddressInfo).port}`, {code: issued.code},
            {configDir, out: () => {}, err: (line) => err.push(line)});
        expect(code).toBe(1);
        expect(err.join("\n")).toContain("man-in-the-middle");
        expect(fs.readdirSync(configDir)).toEqual([]);
    });

    test.each([
        ["a frame with an unknown command", async () => Buffer.concat([Buffer.from("CTRL"), Buffer.from([250, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])])],
        ["a response whose metadata is not valid", async () => {
            const packet = CtrlPacket.createEnrollResponse({ok: false, reason: "rejected"});
            (packet as any)._data = Buffer.from("{not json", "utf-8");
            return packet.toBuffer();
        }]
    ])("REQ-3 %s is a proof failure", async (_label, answer) => {
        const fake = await startFakeServer(answer);
        closers.push(fake.close);
        expect(await join(fake.port)).toBe(1);
        expect(err.join("\n")).toContain("invalid answer");
        expect(fs.readdirSync(configDir)).toEqual([]);
    });

    test.each([
        ["throttled", "too many failed attempts"],
        ["unavailable", "does not accept enrollment"]
    ] as const)("REQ-4 a %s answer exits with 1 and its own message", async (reason, message) => {
        const fake = await startFakeServer(async () => response({ok: false, reason}));
        closers.push(fake.close);
        expect(await join(fake.port)).toBe(1);
        expect(err.join("\n")).toContain(message);
        expect(fs.readdirSync(configDir)).toEqual([]);
    });
});
