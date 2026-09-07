import fs from "fs/promises";
import path from "path";
import AdminServer from "../../../../src/server/admin/AdminServer";
import SessionStore, {BOOTSTRAP_TOKEN_FILE_NAME} from "../../../../src/server/admin/SessionStore";
import ServerOptionStore from "../../../../src/server/ServerOptionStore";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import TTTServer from "../../../../src/server/TTTServer";
import {getFreePort} from "../../../helpers/network";
import {httpRequest} from "../../../helpers/http";
import {createTestRoot, applyTestRoot, cleanupTestRoot} from "../../../helpers/runtime";

export const withConfigurationServer = async (check: (fixture: any) => Promise<void>) => {
    const root = await createTestRoot("config-revision-34");
    const apis: AdminServer[] = [];
    let tunnel: TTTServer | undefined;
    try {
        applyTestRoot(root.rootDir);
        await CertificationStore.instance.load();
        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, port: await getFreePort(),
            adminBindHost: "127.0.0.1", adminTls: true, tls: false, keepAlive: 0, tunnelingOptions: []})) {
            throw new Error("Invalid revision test configuration");
        }
        tunnel = TTTServer.create(store.serverOption);
        await tunnel.start();
        for(let index = 0; index < 2; index++) {
            const api = new AdminServer(tunnel, false);
            apis.push(api);
            await api.listen(0, "127.0.0.1");
        }
        const ports = apis.map((api) => ((api as any)._server.address() as {port: number}).port);
        SessionStore.instance;
        const bootstrapToken = (await fs.readFile(path.join(root.rootDir, "config", BOOTSTRAP_TOKEN_FILE_NAME), "utf8")).trim();
        const login = await httpRequest({port: ports[0], path: "/api/login", method: "POST",
            headers: {"Content-Type": "application/json"}, body: JSON.stringify({key: "revision-password", bootstrapToken})});
        if(login.statusCode !== 200) throw new Error(`Revision fixture login failed: ${login.body}`);
        const cookies = login.headers["set-cookie"] as string[];
        const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
        const csrf = cookies.find((value) => value.startsWith("csrfToken="))!.split(";")[0].slice("csrfToken=".length);
        const request = (method: string, endpoint: string, body?: object, index = 0) => httpRequest({
            port: ports[index], path: endpoint, method,
            headers: {"Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf,
                ...(body === undefined ? {} : {"Content-Length": String(Buffer.byteLength(JSON.stringify(body)))})},
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const snapshot = async () => JSON.parse((await request("GET", "/api/serverOption")).body);
        await check({root, store, tunnel, apis, ports, request, snapshot});
    } finally {
        try { for(const api of apis) await api.close(); }
        finally {
            try { await tunnel?.close(); }
            finally { await cleanupTestRoot(root); }
        }
    }
};
