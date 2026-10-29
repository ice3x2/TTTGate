import {withConfigurationServer} from "./configuration-revision-fixture";
import {getFreePort} from "../../../helpers/network";
import {addTunnel} from "./tunnel-admin-fixture";
import {AdmissionController} from "../../../../src/server/security/AdmissionController";

// #286 — 포트를 고른 차단 항목은 포트 번호가 아니라 터널을 따라간다(REQ-2 AC-2, REQ-3 AC-2).
jest.setTimeout(60000);

const block = async (f: any, address: string, port: number | null) => {
    const response = await f.request("POST", "/api/security/blocklist", {address, port});
    expect(response.statusCode).toBe(201);
};
const storedBlocklist = (f: any) => f.store.serverOption.connectionSecurity?.blocklist ?? [];
const tunnelPorts = (f: any) => (f.store.serverOption.tunnelingOptions ?? []).map((option: {forwardPort: number}) => option.forwardPort);

test("외부 포트를 바꾸면 그 터널의 차단 항목도 새 포트로 옮겨 계속 막는다", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f);
    await block(f, "203.0.113.7", port);
    await block(f, "203.0.113.8", null);
    const next = await getFreePort();
    const response = await f.request("POST", "/api/tunnelingOption", {...option, forwardPort: next, previousForwardPort: port,
        expectedRevision: f.store.revisionState.currentRevision});
    expect(response.statusCode).toBe(200);

    expect(storedBlocklist(f).map((entry: any) => [entry.address, entry.port])).toEqual([["203.0.113.7", next], ["203.0.113.8", null]]);
    expect(AdmissionController.instance.blocklist.isBlocked(next, "203.0.113.7")).toBe(true);
    expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.7")).toBe(false);
}));

test("터널을 지우면 그 터널의 차단 항목도 지운다. 같은 포트로 새로 만든 터널에는 걸리지 않는다", async () => withConfigurationServer(async f => {
    const {port} = await addTunnel(f);
    await block(f, "203.0.113.7", port);
    await block(f, "203.0.113.8", null);
    const response = await f.request("DELETE", "/api/tunnelingOption", {forwardPort: port, expectedRevision: f.store.revisionState.currentRevision});
    expect(response.statusCode).toBe(200);
    expect(tunnelPorts(f)).not.toContain(port);

    expect(storedBlocklist(f).map((entry: any) => entry.address)).toEqual(["203.0.113.8"]);
    expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.7")).toBe(false);
    expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.8")).toBe(true);
}));
