import {withConfigurationServer} from "./configuration-revision-fixture";
import {getFreePort} from "../../../helpers/network";

// #281 — 새 터널은 Inactive on startup 을 따라 켜고, 돌고 있는 터널은 저장해도 손으로 정한 상태를 유지한다.
jest.setTimeout(60000);

const addTunnel = async (f: any, extra: Record<string, unknown> = {}) => {
    const port = await getFreePort();
    const option = {forwardPort: port, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0, ...extra};
    const read = await f.snapshot();
    expect((await f.request("POST", "/api/tunnelingOption", {...option, expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
    return {port, option};
};

/** 포트는 그대로 두고 대상 호스트만 바꿔 저장한다. */
const editDestination = async (f: any, option: any) => {
    const response = await f.request("POST", "/api/tunnelingOption", {...option, destinationAddress: "127.0.0.2",
        expectedRevision: f.store.revisionState.currentRevision});
    expect(response.statusCode).toBe(200);
};

test("a new tunnel that is not inactive on startup starts active (AC-1)", async () => withConfigurationServer(async f => {
    const {port} = await addTunnel(f);
    expect(f.tunnel.externalServerStatus(port).online).toBe(true);
    expect(f.tunnel.externalServerStatus(port).active).toBe(true);
}));

test("a new tunnel that is inactive on startup starts inactive (AC-2)", async () => withConfigurationServer(async f => {
    const {port} = await addTunnel(f, {inactiveOnStartup: true});
    expect(f.tunnel.externalServerStatus(port).online).toBe(true);
    expect(f.tunnel.externalServerStatus(port).active).toBe(false);
}));

test("saving a manually activated tunnel that is inactive on startup keeps it active with the same timer (AC-3)", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f, {inactiveOnStartup: true});
    expect(await f.tunnel.activeExternalPortServer(port, 600)).toBe(true);
    // 시작 시각을 새로 찍는 결함이 같은 밀리초에 숨지 않도록 시간을 조금 흘려보낸다.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = {...f.tunnel.externalServerStatus(port)};
    await editDestination(f, option);
    const after = f.tunnel.externalServerStatus(port);
    expect(after.active).toBe(true);
    expect(after.activeTimeout).toBe(before.activeTimeout);
    expect(after.activeStart).toBe(before.activeStart);
}));

test("saving a manually deactivated tunnel keeps it inactive (AC-4)", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f);
    expect(await f.tunnel.inactiveExternalPortServer(port)).toBe(true);
    await editDestination(f, option);
    expect(f.tunnel.externalServerStatus(port).active).toBe(false);
}));
