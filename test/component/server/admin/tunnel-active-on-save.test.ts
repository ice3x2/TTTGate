import {withConfigurationServer} from "./configuration-revision-fixture";
import {addTunnel} from "./tunnel-admin-fixture";
import {generateSelfSignedCert} from "../../../helpers/testCerts";
import {CertificationStore} from "../../../../src/server/CertificationStore";

// #281 — 새 터널은 Inactive on startup 을 따라 켜고, 돌고 있는 터널은 저장해도 손으로 정한 상태를 유지한다.
jest.setTimeout(60000);

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
    expect(after.requestedTimeout).toBe(before.requestedTimeout);
    expect(after.activeStart).toBe(before.activeStart);
}));

test("saving a manually deactivated tunnel keeps it inactive (AC-4)", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f);
    expect(await f.tunnel.inactiveExternalPortServer(port)).toBe(true);
    await editDestination(f, option);
    expect(f.tunnel.externalServerStatus(port).active).toBe(false);
}));

// 인증서를 바꿔 저장해도(certInfo 를 함께 보내는 저장) 손으로 켠 상태와 타이머를 유지한다(REQ-3).
test("saving with a new certificate keeps a manually activated tunnel active with the same timer (REQ-3)", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f, {inactiveOnStartup: true});
    expect(await f.tunnel.activeExternalPortServer(port, 600)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = {...f.tunnel.externalServerStatus(port)};
    const bundle = generateSelfSignedCert("active-on-save");
    const response = await f.request("POST", "/api/tunnelingOption", {...option, tls: true,
        certInfo: {key: {name: `k-${port}.key`, value: bundle.keyPem}, cert: {name: `c-${port}.crt`, value: bundle.certPem}, ca: {name: "", value: ""}},
        expectedRevision: f.store.revisionState.currentRevision,
        expectedCertificateRevision: CertificationStore.instance.revisionState.currentRevision});
    expect(response.statusCode).toBe(200);
    const after = f.tunnel.externalServerStatus(port);
    expect(after.active).toBe(true);
    expect(after.activeStart).toBe(before.activeStart);
}));

// 지운 터널의 상태는 남아 있지만, 같은 포트로 다시 만든 터널은 새 터널로 다룬다(REQ-4).
test("a tunnel deleted and added again on the same port is treated as new (REQ-4)", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f, {inactiveOnStartup: true});
    expect(await f.tunnel.activeExternalPortServer(port, 0)).toBe(true);
    expect((await f.request("DELETE", "/api/tunnelingOption", {forwardPort: port, expectedRevision: f.store.revisionState.currentRevision})).statusCode).toBe(200);
    const response = await f.request("POST", "/api/tunnelingOption", {...option, expectedRevision: f.store.revisionState.currentRevision});
    expect(response.statusCode).toBe(200);
    expect(f.tunnel.externalServerStatus(port).online).toBe(true);
    expect(f.tunnel.externalServerStatus(port).active).toBe(false);
}));
