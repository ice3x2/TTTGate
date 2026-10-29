import {withConfigurationServer} from "./configuration-revision-fixture";
import {getFreePort} from "../../../helpers/network";
import {addTunnel} from "./tunnel-admin-fixture";
import {AdmissionController} from "../../../../src/server/security/AdmissionController";
import {AuditEvent, AuditSink, AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {generateSelfSignedCert} from "../../../helpers/testCerts";

/** 감사 이벤트를 메모리에 모은다. 끝나면 반드시 reset 한다. */
const captureAudit = (): {events: AuditEvent[]; reset: () => void} => {
    const events: AuditEvent[] = [];
    const sink: AuditSink = {reserve: () => true, record: (event: AuditEvent) => { events.push(event); return Promise.resolve(); }};
    AuditSinkRegistry.set(sink);
    return {events, reset: () => AuditSinkRegistry.reset()};
};

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
    const audit = captureAudit();
    try {
        const response = await f.request("POST", "/api/tunnelingOption", {...option, forwardPort: next, previousForwardPort: port,
            expectedRevision: f.store.revisionState.currentRevision});
        expect(response.statusCode).toBe(200);
        // 옮긴 항목은 터널 저장 감사에 남는다.
        const saved = audit.events.filter((event) => event.type.startsWith("tunnel_"));
        expect(saved[saved.length - 1].detail).toMatchObject({movedBlocks: [{address: "203.0.113.7", from: port, to: next}]});
    } finally {
        audit.reset();
    }

    expect(storedBlocklist(f).map((entry: any) => [entry.address, entry.port])).toEqual([["203.0.113.7", next], ["203.0.113.8", null]]);
    expect(AdmissionController.instance.blocklist.isBlocked(next, "203.0.113.7")).toBe(true);
    expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.7")).toBe(false);
}));

// 옛 리스너는 새 리스너가 뜨고 자기가 멈출 때까지 연결을 받는다. 그동안 옛 포트에서도 차단이 걸려 있어야 한다.
test("포트를 바꾸는 동안 옛 리스너와 새 리스너 모두 차단을 건다", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f);
    await block(f, "203.0.113.7", port);
    const next = await getFreePort();
    const seen: Array<[string, boolean, boolean]> = [];
    const record = (stage: string) => seen.push([stage,
        AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.7"), AdmissionController.instance.blocklist.isBlocked(next, "203.0.113.7")]);
    const apply = f.tunnel.applyTunnelingOption.bind(f.tunnel);
    const stopListener = f.tunnel.stopExternalPortServer.bind(f.tunnel);
    const applySpy = jest.spyOn(f.tunnel, "applyTunnelingOption").mockImplementation(async (...args: any[]) => { record("apply"); return apply(...args); });
    const stopSpy = jest.spyOn(f.tunnel, "stopExternalPortServer").mockImplementation(async (...args: any[]) => { record("stop"); return stopListener(...args); });
    try {
        const response = await f.request("POST", "/api/tunnelingOption", {...option, forwardPort: next, previousForwardPort: port,
            expectedRevision: f.store.revisionState.currentRevision});
        expect(response.statusCode).toBe(200);
    } finally {
        applySpy.mockRestore();
        stopSpy.mockRestore();
    }
    expect(seen).toEqual([["apply", true, true], ["stop", true, true]]);
    expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.7")).toBe(false);
    expect(AdmissionController.instance.blocklist.isBlocked(next, "203.0.113.7")).toBe(true);
}));

test("터널을 지우는 동안 리스너가 멈출 때까지 차단을 건다", async () => withConfigurationServer(async f => {
    const {port} = await addTunnel(f);
    await block(f, "203.0.113.7", port);
    const seen: boolean[] = [];
    const stopListener = f.tunnel.stopExternalPortServer.bind(f.tunnel);
    const stopSpy = jest.spyOn(f.tunnel, "stopExternalPortServer").mockImplementation(async (...args: any[]) => {
        seen.push(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.7"));
        return stopListener(...args);
    });
    try {
        expect((await f.request("DELETE", "/api/tunnelingOption", {forwardPort: port, expectedRevision: f.store.revisionState.currentRevision})).statusCode).toBe(200);
    } finally {
        stopSpy.mockRestore();
    }
    expect(seen).toEqual([true]);
    expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.7")).toBe(false);
}));

// 서버 설정 저장으로 터널을 빼도 그 리스너는 다시 시작할 때까지 돈다. 그동안 그 포트의 항목도 남아 계속 막는다.
// 남은 리스너가 포트를 쥐고 있으므로 같은 포트로 새 터널을 만들 수 없고, 항목은 다시 시작할 때 고아로 빠진다.
test("서버 설정 저장으로 터널을 빼도 그 포트의 항목은 남는다", async () => withConfigurationServer(async f => {
    const {port} = await addTunnel(f);
    await block(f, "203.0.113.7", port);
    const read = await f.snapshot();
    const response = await f.request("POST", "/api/serverOption", {...read.serverOption, tunnelingOptions: [],
        expectedRevision: read.revisionState.currentRevision});
    expect(response.statusCode).toBe(200);
    expect(tunnelPorts(f)).not.toContain(port);
    expect(storedBlocklist(f).map((entry: any) => entry.port)).toEqual([port]);
    expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.7")).toBe(true);
}));

// 리스너가 꺼진 터널을 서버 설정 저장으로 빼면 그 포트의 항목이 남는다. 그 포트로 새 터널을 만들면 그 항목을 물려받지 않는다.
// 인증서를 붙여 만드는 TLS 터널은 다른 저장 경로(compound)를 지나므로 두 경로를 모두 본다. 빠진 항목은 터널 저장 감사에 남는다.
const leaveOrphan = (f: any, port: number) => {
    const read = f.store.readServerOption();
    read.serverOption.connectionSecurity = {...read.serverOption.connectionSecurity, blocklist: [
        {address: "203.0.113.7", port, note: "old", createdAt: 1, createdBy: "admin"},
        {address: "203.0.113.8", port: null, note: "", createdAt: 1, createdBy: "admin"}]};
    expect(f.store.commitPreparedServerOption(read.serverOption).success).toBe(true);
    f.tunnel.applyConnectionSecurity(f.store.serverOption.connectionSecurity);
};

test.each(["plain", "with certificate"])("새 터널을 만들면 그 포트에 남아 있던 고아 항목을 뺀다 (%s)", async (mode) => withConfigurationServer(async f => {
    const port = await getFreePort();
    leaveOrphan(f, port);
    const bundle = generateSelfSignedCert("orphan-blocklist");
    const extra = mode === "plain" ? {tls: false} : {
        tls: true,
        certInfo: {key: {name: `orphan-${port}.key`, value: bundle.keyPem}, cert: {name: `orphan-${port}.crt`, value: bundle.certPem}, ca: {name: "", value: ""}},
        expectedCertificateRevision: CertificationStore.instance.revisionState.currentRevision
    };
    const audit = captureAudit();
    try {
        const response = await f.request("POST", "/api/tunnelingOption", {forwardPort: port, protocol: "tcp", destinationAddress: "127.0.0.1",
            destinationPort: 9, keepAlive: 0, ...extra, expectedRevision: f.store.revisionState.currentRevision});
        expect(response.statusCode).toBe(200);
        const saved = audit.events.filter((event) => event.type.startsWith("tunnel_"));
        expect(saved[saved.length - 1].detail).toMatchObject({droppedBlocks: [{address: "203.0.113.7", note: "old"}]});
    } finally {
        audit.reset();
    }
    expect(storedBlocklist(f).map((entry: any) => entry.address)).toEqual(["203.0.113.8"]);
    expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.7")).toBe(false);
}));

const addOrphan = (f: any, address: string, port: number) => {
    const read = f.store.readServerOption();
    read.serverOption.connectionSecurity = {...read.serverOption.connectionSecurity,
        blocklist: [...(read.serverOption.connectionSecurity?.blocklist ?? []), {address, port, note: "old", createdAt: 1, createdBy: "admin"}]};
    expect(f.store.commitPreparedServerOption(read.serverOption).success).toBe(true);
    f.tunnel.applyConnectionSecurity(f.store.serverOption.connectionSecurity);
};

test("고아 항목이 있는 포트로 포트를 바꾸면 고아 항목은 빼고 옮긴 항목만 남기며 둘 다 감사에 남긴다", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f);
    await block(f, "203.0.113.7", port);
    const next = await getFreePort();
    addOrphan(f, "203.0.113.9", next);
    const audit = captureAudit();
    try {
        const response = await f.request("POST", "/api/tunnelingOption", {...option, forwardPort: next, previousForwardPort: port,
            expectedRevision: f.store.revisionState.currentRevision});
        expect(response.statusCode).toBe(200);
        const saved = audit.events.filter((event) => event.type.startsWith("tunnel_"));
        expect(saved[saved.length - 1].detail).toMatchObject({
            movedBlocks: [{address: "203.0.113.7", from: port, to: next}],
            droppedBlocks: [{address: "203.0.113.9", note: "old"}]
        });
    } finally {
        audit.reset();
    }
    expect(storedBlocklist(f).map((entry: any) => [entry.address, entry.port])).toEqual([["203.0.113.7", next]]);
    expect(AdmissionController.instance.blocklist.isBlocked(next, "203.0.113.9")).toBe(false);
    expect(AdmissionController.instance.blocklist.isBlocked(next, "203.0.113.7")).toBe(true);
}));

test("고아 항목이 있는 포트에 새 터널을 만들다 실패하면 고아 항목도 되돌린다", async () => withConfigurationServer(async f => {
    const port = await getFreePort();
    addOrphan(f, "203.0.113.9", port);
    const failure = jest.spyOn(f.tunnel, "applyTunnelingOption")
        .mockResolvedValueOnce({success: false, partial: false, failedScopes: ["external-listener:test"], warnings: [], restartRequiredScopes: []});
    try {
        const response = await f.request("POST", "/api/tunnelingOption", {forwardPort: port, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1",
            destinationPort: 9, keepAlive: 0, expectedRevision: f.store.revisionState.currentRevision});
        expect(response.statusCode).toBe(400);
    } finally {
        failure.mockRestore();
    }
    expect(storedBlocklist(f).map((entry: any) => [entry.address, entry.port])).toEqual([["203.0.113.9", port]]);
    expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.9")).toBe(true);
}));

// 관리 화면은 보내지 않지만, 서버 설정 저장 API 로 터널 목록을 직접 바꿔 고아 포트에 터널을 더할 수도 있다.
test("서버 설정 저장으로 고아 포트에 터널을 더해도 그 항목을 빼고 감사에 남긴다", async () => withConfigurationServer(async f => {
    const port = await getFreePort();
    addOrphan(f, "203.0.113.9", port);
    const read = await f.snapshot();
    const tunnel = {forwardPort: port, protocol: "tcp", tls: false, destinationAddress: "127.0.0.1", destinationPort: 9, keepAlive: 0};
    const audit = captureAudit();
    try {
        const response = await f.request("POST", "/api/serverOption", {...read.serverOption,
            tunnelingOptions: [...f.store.serverOption.tunnelingOptions, tunnel], expectedRevision: read.revisionState.currentRevision});
        expect(response.statusCode).toBe(200);
        const saved = audit.events.filter((event) => event.type === "server_option_updated");
        expect(saved[saved.length - 1].detail).toMatchObject({droppedBlocks: [{address: "203.0.113.9", note: "old"}]});
    } finally {
        audit.reset();
    }
    expect(storedBlocklist(f)).toEqual([]);
    expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.9")).toBe(false);
}));

test("터널이 없는 포트에는 포트를 고른 항목을 넣을 수 없다", async () => withConfigurationServer(async f => {
    const {port} = await addTunnel(f);
    const unused = await getFreePort();
    const missing = await f.request("POST", "/api/security/blocklist", {address: "203.0.113.7", port: unused});
    expect(missing.statusCode).toBe(422);
    expect(JSON.parse(missing.body).message).toBe(`no tunnel uses port ${unused}`);

    // 화면이 터널 목록을 읽은 뒤 그 터널이 지워졌을 때도 같다.
    expect((await f.request("DELETE", "/api/tunnelingOption", {forwardPort: port, expectedRevision: f.store.revisionState.currentRevision})).statusCode).toBe(200);
    const stale = await f.request("POST", "/api/security/blocklist", {address: "203.0.113.7", port});
    expect(stale.statusCode).toBe(422);
    expect(storedBlocklist(f)).toEqual([]);
}));

test("포트 변경이 실패해 되돌리면 차단 항목도 옛 포트로 돌아온다", async () => withConfigurationServer(async f => {
    const {port, option} = await addTunnel(f);
    await block(f, "203.0.113.7", port);
    const failure = jest.spyOn(f.tunnel, "applyTunnelingOption")
        .mockResolvedValueOnce({success: false, partial: false, failedScopes: ["external-listener:test"], warnings: [], restartRequiredScopes: []});
    try {
        const next = await getFreePort();
        const response = await f.request("POST", "/api/tunnelingOption", {...option, forwardPort: next, previousForwardPort: port,
            expectedRevision: f.store.revisionState.currentRevision});
        expect(response.statusCode).toBe(400);
        expect(storedBlocklist(f).map((entry: any) => entry.port)).toEqual([port]);
        expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.7")).toBe(true);
        expect(AdmissionController.instance.blocklist.isBlocked(next, "203.0.113.7")).toBe(false);
    } finally {
        failure.mockRestore();
    }
}));

test("터널 삭제가 실패해 되돌리면 차단 항목도 남는다", async () => withConfigurationServer(async f => {
    const {port} = await addTunnel(f);
    await block(f, "203.0.113.7", port);
    const failure = jest.spyOn(f.tunnel, "stopExternalPortServer").mockResolvedValueOnce(false);
    try {
        const response = await f.request("DELETE", "/api/tunnelingOption", {forwardPort: port, expectedRevision: f.store.revisionState.currentRevision});
        expect(response.statusCode).toBe(400);
        expect(storedBlocklist(f).map((entry: any) => entry.port)).toEqual([port]);
        expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.7")).toBe(true);
    } finally {
        failure.mockRestore();
    }
}));

test("터널을 지우면 그 터널의 차단 항목도 지운다. 같은 포트로 새로 만든 터널에는 걸리지 않는다", async () => withConfigurationServer(async f => {
    const {port} = await addTunnel(f);
    await block(f, "203.0.113.7", port);
    await block(f, "203.0.113.8", null);
    const audit = captureAudit();
    try {
        const response = await f.request("DELETE", "/api/tunnelingOption", {forwardPort: port, expectedRevision: f.store.revisionState.currentRevision});
        expect(response.statusCode).toBe(200);
        // 터널 소유자는 security:manage 권한이 없어도 자기 터널을 지운다. 그때 풀린 차단은 감사로 확인할 수 있어야 한다.
        const deleted = audit.events.filter((event) => event.type === "tunnel_deleted");
        expect(deleted[deleted.length - 1].detail).toMatchObject({droppedBlocks: [{address: "203.0.113.7", note: ""}]});
    } finally {
        audit.reset();
    }
    expect(tunnelPorts(f)).not.toContain(port);

    expect(storedBlocklist(f).map((entry: any) => entry.address)).toEqual(["203.0.113.8"]);
    expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.7")).toBe(false);
    expect(AdmissionController.instance.blocklist.isBlocked(port, "203.0.113.8")).toBe(true);
}));
