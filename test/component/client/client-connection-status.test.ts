import * as fs from "fs";
import * as path from "path";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import TTTServer from "../../../src/server/TTTServer";
import TTTClient from "../../../src/client/TTTClient";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {readClientStatus, trackClientStatus} from "../../../src/client/ClientStatusFile";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

jest.setTimeout(60_000);

// #322 REQ-15 실행 중인 클라이언트가 연결 상태 파일을 쓴다.
describe("client connection status file", () => {
    let root: TestRoot;
    let binDir: string;
    const clients: TTTClient[] = [];
    let server: TTTServer | undefined;

    beforeEach(async () => {
        root = await createTestRoot("client-connection-status");
        applyTestRoot(root.rootDir);
        binDir = path.join(root.rootDir, "bin");
        fs.mkdirSync(binDir, {recursive: true});
    });
    afterEach(async () => {
        clients.splice(0).forEach((client) => client.stop());
        await server?.close();
        server = undefined;
        await cleanupTestRoot(root);
    });

    const waitForState = (state: string, failures?: number) => waitFor(() => {
        const status = readClientStatus(binDir);
        if(status?.state !== state || (failures !== undefined && status.failures < failures)) throw new Error(JSON.stringify(status));
        return true;
    }, {timeoutMs: 20_000, intervalMs: 50});

    test("a client that cannot reach the server records reconnecting with failures", async () => {
        const port = await getFreePort();
        const client = TTTClient.create({key: DEFAULT_KEY, host: "127.0.0.1", port, tls: false, name: "edge", keepAlive: 0, globalMemCacheLimit: 128});
        clients.push(client);
        trackClientStatus(client, binDir);
        client.start();
        await waitForState("reconnecting", 1);
        expect(readClientStatus(binDir)?.pid).toBe(process.pid);
    });

    test("a client that reaches the server records connected", async () => {
        await CertificationStore.instance.load();
        const port = await getFreePort();
        const option: ServerOption = {key: DEFAULT_KEY, adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port, tls: false,
            controlProtocolMode: "mixed", trustedClients: [{clientId: "edge", clientSecret: "edge-secret-value", displayName: "Edge"}],
            tunnelingOptions: [], keepAlive: 0, globalMemCacheLimit: 128};
        if(!ServerOptionStore.instance.updateServerOption(option)) throw new Error("bad fixture");
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();
        const client = TTTClient.create({key: DEFAULT_KEY, host: "127.0.0.1", port, tls: false, name: "edge", keepAlive: 0,
            globalMemCacheLimit: 128, clientId: "edge", clientSecret: "edge-secret-value"});
        clients.push(client);
        trackClientStatus(client, binDir);
        client.start();
        await waitForState("connected");
        expect(readClientStatus(binDir)?.failures).toBe(0);
    });
});
