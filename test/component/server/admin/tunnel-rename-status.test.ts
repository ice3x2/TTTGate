import {withConfigurationServer} from "./configuration-revision-fixture";
import {getFreePort} from "../../../helpers/network";

// 이슈 279 — 외부 포트를 바꾸면 새 포트의 리스너가 옛 포트의 활성 상태를 이어받는다.
jest.setTimeout(60000);

const addTunnel = async (f: any, extra: Record<string, unknown> = {}) => {
    const port = await getFreePort();
    const option = {forwardPort: port, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0, ...extra};
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

// 손으로 켠 터널은 "Inactive on startup" 이 켜져 있어도 포트를 바꾼 뒤 켜진 채로 남는다.
test("renaming a manually activated tunnel that is inactive on startup keeps it active (REQ-1)", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f, {inactiveOnStartup: true});
    expect(await f.tunnel.activeExternalPortServer(port, 0)).toBe(true);
    const next = await rename(f, option, port);
    expect(f.tunnel.externalServerStatus(next).active).toBe(true);
}));

// 활성 시간(초)과 그 시작 시각도 이어받는다. 포트를 바꿨다고 타이머가 처음부터 다시 돌지 않는다.
test("renaming keeps the active timeout and its start time (REQ-1)", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f);
    expect(await f.tunnel.activeExternalPortServer(port, 600)).toBe(true);
    // 시작 시각을 새로 찍는 결함이 같은 밀리초에 숨지 않도록 시간을 조금 흘려보낸다.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = {...f.tunnel.externalServerStatus(port)};
    const next = await rename(f, option, port);
    const after = f.tunnel.externalServerStatus(next);
    expect(after.active).toBe(true);
    expect(after.activeTimeout).toBe(before.activeTimeout);
    expect(after.requestedTimeout).toBe(before.requestedTimeout);
    expect(after.activeStart).toBe(before.activeStart);
}));
