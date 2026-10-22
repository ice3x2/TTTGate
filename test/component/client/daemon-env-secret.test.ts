jest.setTimeout(90_000);

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import YAML from "yaml";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import TTTServer from "../../../src/server/TTTServer";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {getFreePort, waitFor} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";
import {spawnProcess} from "../../helpers/smokeProcess";
import {recordedDaemonPids, stopDaemon} from "../../helpers/daemonCleanup";

const APP_JS = path.resolve(__dirname, "../../../build/src/app.js");

// #223 — -daemon 의 앱 자식이 TTTGATE_CLIENT_SECRET 을 그대로 받아 v2 로 인증한다(#209 REQ-7).
test("a -daemon client authenticates with the secret from TTTGATE_CLIENT_SECRET", async () => {
    let root: TestRoot | undefined;
    let server: TTTServer | undefined;
    const clientRoot = fs.mkdtempSync(path.join(os.tmpdir(), "daemon-secret-"));
    let leftover: number[] = [];
    try {
        root = await createTestRoot("daemon-secret");
        applyTestRoot(root.rootDir);
        await CertificationStore.instance.load();
        const port = await getFreePort();
        const option: ServerOption = {key: DEFAULT_KEY, adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port, tls: false,
            controlProtocolMode: "mixed", trustedClients: [{clientId: "edge", clientSecret: "daemon-env-secret-value"}],
            tunnelingOptions: [], keepAlive: 0, globalMemCacheLimit: 128};
        if(!ServerOptionStore.instance.updateServerOption(option)) throw new Error("bad fixture");
        server = TTTServer.create(ServerOptionStore.instance.serverOption);
        await server.start();

        for(const sub of ["config", "bin"]) fs.mkdirSync(path.join(clientRoot, sub));
        // 비밀값은 client.yaml 에도 명령줄에도 없다. 환경 변수로만 준다.
        fs.writeFileSync(path.join(clientRoot, "config", "client.yaml"), YAML.stringify({host: "127.0.0.1", port, clientId: "edge", name: "edge"}));
        const parent = spawnProcess(process.execPath, [APP_JS, "client", "-daemon"], {cwd: clientRoot,
            env: {TTTGATE_CLIENT_SECRET: "daemon-env-secret-value"}});
        expect(await parent.waitForExit(20_000)).toBe(0);
        expect(parent.readChannel().stdout + parent.readChannel().stderr).not.toContain("daemon-env-secret-value");

        await waitFor(() => {
            if(!server!.clientStatus().some((status) => status.clientId === "edge" && !status.legacy)) throw new Error("daemon client not online");
            return true;
        }, {timeoutMs: 30_000, intervalMs: 200});
        expect(recordedDaemonPids(clientRoot).length).toBeGreaterThanOrEqual(2);
    } finally {
        leftover = await stopDaemon(APP_JS, clientRoot);
        await server?.close();
        if(root) await cleanupTestRoot(root);
        fs.rmSync(clientRoot, {recursive: true, force: true});
    }
    expect(leftover).toEqual([]);
});
