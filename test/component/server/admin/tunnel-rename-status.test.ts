import {withConfigurationServer} from "./configuration-revision-fixture";
import {getFreePort} from "../../../helpers/network";

// 이슈 279 — 외부 포트를 바꾸면 새 포트의 리스너가 옛 포트의 활성 상태를 이어받는다.
jest.setTimeout(60000);

const addTunnel = async (f: any) => {
    const port = await getFreePort();
    const option = {forwardPort: port, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0};
    const read = await f.snapshot();
    expect((await f.request("POST", "/api/tunnelingOption", {...option, expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
    return {port, option};
};

const rename = async (f: any, option: any, from: number) => {
    const to = await getFreePort();
    const response = await f.request("POST", "/api/tunnelingOption", {...option, forwardPort: to, previousForwardPort: from,
        expectedRevision: f.store.revisionState.currentRevision});
    expect(response.statusCode).toBe(200);
    return to;
};

test("renaming an active tunnel keeps the new listener active (AC-1, AC-3)", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f);
    expect(await f.tunnel.activeExternalPortServer(port, 0)).toBe(true);
    const next = await rename(f, option, port);
    const status = f.tunnel.externalServerStatus(next);
    expect(status.online).toBe(true);
    expect(status.active).toBe(true);
    expect(f.tunnel.externalServerStatus(port).online).toBe(false);
}));

test("renaming an inactive tunnel keeps the new listener inactive (AC-2)", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f);
    expect(await f.tunnel.inactiveExternalPortServer(port)).toBe(true);
    const next = await rename(f, option, port);
    const status = f.tunnel.externalServerStatus(next);
    expect(status.online).toBe(true);
    expect(status.active).toBe(false);
}));
