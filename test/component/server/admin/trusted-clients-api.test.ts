import {withConfigurationServer} from "./configuration-revision-fixture";
import {IdentityStore} from "../../../../src/server/rbac/IdentityStore";
import {getFreePort} from "../../../helpers/network";

jest.setTimeout(60_000);

const body = (response: {body: string}) => JSON.parse(response.body);
const revision = async (f: any) => (await f.snapshot()).revisionState.currentRevision;

// #212 신뢰 클라이언트 관리 API(REQ-1·1a·2·9·10·11)
describe("trusted client admin API", () => {
    test("REQ-1 create makes a server-generated secret that the API never returns", async () => withConfigurationServer(async f => {
        const created = await f.request("POST", "/api/trustedClients", {clientId: "edge-1", displayName: "Edge 1", expectedRevision: await revision(f)});
        expect(created.statusCode).toBe(201);
        expect(body(created).trustedClient).toEqual({clientId: "edge-1", displayName: "Edge 1"});
        const stored = f.store.serverOption.trustedClients.find((client: any) => client.clientId === "edge-1");
        expect(stored.clientSecret).toMatch(/^[0-9a-f]{64}$/);
        expect(created.body).not.toContain(stored.clientSecret);

        const duplicate = await f.request("POST", "/api/trustedClients", {clientId: "edge-1", expectedRevision: await revision(f)});
        expect(duplicate.statusCode).toBe(409);
        const invalid = await f.request("POST", "/api/trustedClients", {clientId: "bad id!", expectedRevision: await revision(f)});
        expect(invalid.statusCode).toBe(400);
    }));

    test("REQ-9/10 server options hide secrets, keep trusted clients when sent back, and refuse changes", async () => withConfigurationServer(async f => {
        await f.request("POST", "/api/trustedClients", {clientId: "edge-1", expectedRevision: await revision(f)});
        const secret = f.store.serverOption.trustedClients[0].clientSecret;
        const read = await f.snapshot();
        expect(JSON.stringify(read)).not.toContain(secret);
        expect(read.serverOption.trustedClients[0].clientSecret).toBe("********");

        const sentBack = await f.request("POST", "/api/serverOption", {...read.serverOption, globalMemCacheLimit: 129, expectedRevision: read.revisionState.currentRevision});
        expect(sentBack.statusCode).toBe(200);
        expect(f.store.serverOption.trustedClients[0].clientSecret).toBe(secret);

        const without = await f.snapshot();
        const {trustedClients: _omit, ...rest} = without.serverOption;
        expect((await f.request("POST", "/api/serverOption", {...rest, globalMemCacheLimit: 130, expectedRevision: without.revisionState.currentRevision})).statusCode).toBe(200);
        expect(f.store.serverOption.trustedClients).toHaveLength(1);

        const changed = await f.snapshot();
        const refused = await f.request("POST", "/api/serverOption", {...changed.serverOption,
            trustedClients: [{clientId: "edge-1", clientSecret: "attacker-chosen"}], expectedRevision: changed.revisionState.currentRevision});
        expect(refused.statusCode).toBe(400);
        expect(f.store.serverOption.trustedClients[0].clientSecret).toBe(secret);
    }));

    test("REQ-1a a client referenced by a tunnel or a group cannot be deleted", async () => withConfigurationServer(async f => {
        await f.request("POST", "/api/trustedClients", {clientId: "edge-1", expectedRevision: await revision(f)});
        const port = await getFreePort();
        expect((await f.request("POST", "/api/tunnelingOption", {forwardPort: port, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1",
            destinationPort: 9, allowedClientIds: ["edge-1"], expectedRevision: await revision(f)})).statusCode).toBe(200);
        const blocked = await f.request("DELETE", `/api/trustedClients/edge-1`, {expectedRevision: await revision(f)});
        expect(blocked.statusCode).toBe(409);
        expect(body(blocked).references).toEqual([{kind: "tunnel", id: String(port)}]);

        expect((await f.request("DELETE", "/api/tunnelingOption", {forwardPort: port, expectedRevision: await revision(f)})).statusCode).toBe(200);
        const createdGroup = IdentityStore.instance.createGroup({name: "edge-group"});
        if(!createdGroup.success) throw new Error(createdGroup.message);
        const group = createdGroup.value;
        const updated = IdentityStore.instance.updateGroup(group.id, {attributes: {...group.attributes, allowed_trusted_clients: ["edge-1"]}});
        expect(updated.success).toBe(true);
        const byGroup = await f.request("DELETE", `/api/trustedClients/edge-1`, {expectedRevision: await revision(f)});
        expect(byGroup.statusCode).toBe(409);
        expect(body(byGroup).references).toEqual([{kind: "group", id: group.id}]);

        IdentityStore.instance.updateGroup(group.id, {attributes: {...group.attributes, allowed_trusted_clients: []}});
        expect((await f.request("DELETE", `/api/trustedClients/edge-1`, {expectedRevision: await revision(f)})).statusCode).toBe(200);
        expect(f.store.serverOption.trustedClients).toEqual([]);
    }));

    test("REQ-7 rotating the secret replaces it", async () => withConfigurationServer(async f => {
        await f.request("POST", "/api/trustedClients", {clientId: "edge-1", expectedRevision: await revision(f)});
        const before = f.store.serverOption.trustedClients[0].clientSecret;
        const rotated = await f.request("POST", `/api/trustedClients/edge-1/secret`, {expectedRevision: await revision(f)});
        expect(rotated.statusCode).toBe(200);
        expect(f.store.serverOption.trustedClients[0].clientSecret).not.toBe(before);
        expect(rotated.body).not.toContain(f.store.serverOption.trustedClients[0].clientSecret);
        expect((await f.request("POST", `/api/trustedClients/nobody/secret`, {expectedRevision: await revision(f)})).statusCode).toBe(404);
    }));

    test("REQ-4/8 enrollment codes need TLS on the control port and name the control port", async () => withConfigurationServer(async f => {
        await f.request("POST", "/api/trustedClients", {clientId: "edge-1", expectedRevision: await revision(f)});
        const plain = await f.request("POST", `/api/trustedClients/edge-1/enrollmentCode`, {});
        expect(plain.statusCode).toBe(409);
        expect(body(plain).code).toBe("TLS_REQUIRED");

        const read = await f.snapshot();
        expect((await f.request("POST", "/api/serverOption", {...read.serverOption, tls: true, expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
        const issued = await f.request("POST", `/api/trustedClients/edge-1/enrollmentCode`, {ttlMinutes: 30});
        expect(issued.statusCode).toBe(200);
        const value = body(issued);
        expect(value.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
        expect(value.expiresAt - Date.now()).toBeGreaterThan(29 * 60_000);
        expect(value.controlPort).toBe(f.store.serverOption.port);
        expect((await f.request("POST", `/api/trustedClients/nobody/enrollmentCode`, {})).statusCode).toBe(404);
    }));
});
