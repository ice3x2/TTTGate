import LoggerFactory from "../../../../src/util/logger/LoggerFactory";
import {SocketHandler} from "../../../../src/util/SocketHandler";
import {withConfigurationServer} from "./configuration-revision-fixture";
import {CertificationStore} from "../../../../src/server/CertificationStore";
import {getFreePort} from "../../../helpers/network";
import {generateSelfSignedCert} from "../../../helpers/testCerts";
import fs from "fs";
import os from "os";
import path from "path";
import {AuditSinkRegistry} from "../../../../src/server/audit/AuditSink";
import {FileAuditSink} from "../../../../src/server/audit/FileAuditSink";

// #271 — 런타임 적용이 예외를 던져도 적용 실패와 같이 저장 전 설정과 실행 상태로 되돌린다.
jest.setTimeout(60_000);

const SECRET_TEXT = "apply exploded with internal detail";
const writerLevels = (): string[] => [...(LoggerFactory as any)._logWriterMap.values()].map((writer: any) => writer.level);

/** 실제 적용은 그대로 한 뒤 예외를 던지게 한다(일부 범위를 바꾼 뒤 실패하는 경우). */
const throwAfterApply = (tunnel: any, method = "applyServerOption") => {
    const apply = tunnel[method];
    let calls = 0;
    tunnel[method] = async (...args: any[]) => {
        await apply.apply(tunnel, args);
        calls++;
        throw new Error(SECRET_TEXT);
    };
    return {calls: () => calls, restore: () => { tunnel[method] = apply; }};
};

describe("runtime apply that throws (#271)", () => {
    let previous: {stall: number, grace: number};
    beforeEach(() => { previous = {stall: SocketHandler.closeStallMs, grace: SocketHandler.closeGraceMs}; });
    afterEach(() => {
        SocketHandler.closeStallMs = previous.stall;
        SocketHandler.closeGraceMs = previous.grace;
        LoggerFactory.setLevel(undefined);
    });

    test("a server option save rolls back the stored option, the revision and the running state (AC-1)", async () => withConfigurationServer(async ({request, snapshot, store, tunnel}) => {
        const read = await snapshot();
        expect((await request("POST", "/api/serverOption", {...read.serverOption, logLevel: "warn", closeGraceMs: 5_000,
            expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
        const baseline = await snapshot();
        const thrower = throwAfterApply(tunnel);
        try {
            const failed = await request("POST", "/api/serverOption", {...baseline.serverOption, logLevel: "debug", closeGraceMs: 2_000,
                expectedRevision: baseline.revisionState.currentRevision});
            expect(thrower.calls()).toBe(1);
            expect(failed.statusCode).toBe(400);
            const body = JSON.parse(failed.body);
            expect(body).toMatchObject({success: false, updated: false, message: "Unable to apply server option."});
            expect(body.failedScopes).toContain("server-runtime");
            expect(failed.body).not.toContain(SECRET_TEXT);
            expect(store.serverOption).toMatchObject({logLevel: "warn", closeGraceMs: 5_000});
            expect(store.revisionState.currentRevision).toBe(baseline.revisionState.currentRevision);
            expect(new Set(writerLevels())).toEqual(new Set(["warn"]));
            expect(SocketHandler.closeGraceMs).toBe(5_000);
        } finally { thrower.restore(); }
    }));

    test("a trusted client save rolls back the stored clients and the revision (AC-2)", async () => withConfigurationServer(async ({request, snapshot, store, tunnel}) => {
        const before = await snapshot();
        const clientsBefore = store.serverOption.trustedClients ?? [];
        const thrower = throwAfterApply(tunnel);
        try {
            const failed = await request("POST", "/api/trustedClients", {clientId: "edge-throw", displayName: "Edge",
                expectedRevision: before.revisionState.currentRevision});
            expect(thrower.calls()).toBe(1);
            expect(failed.statusCode).toBe(500);
            expect(JSON.parse(failed.body)).toMatchObject({success: false, message: "Unable to apply trusted clients."});
            expect(failed.body).not.toContain(SECRET_TEXT);
            expect(store.serverOption.trustedClients ?? []).toEqual(clientsBefore);
            expect(store.revisionState.currentRevision).toBe(before.revisionState.currentRevision);
        } finally { thrower.restore(); }
        // 되돌린 뒤에도 같은 저장은 정상으로 된다.
        const again = await snapshot();
        expect((await request("POST", "/api/trustedClients", {clientId: "edge-throw", displayName: "Edge",
            expectedRevision: again.revisionState.currentRevision})).statusCode).toBe(201);
    }));

    // 같은 결함: 터널 저장과 외부 인증서 저장도 적용이 예외를 던지면 저장을 되돌려야 한다(REQ-1 은 런타임 적용 전체다).
    test("a tunnel save rolls back the stored tunnel and the revision (AC-3)", async () => withConfigurationServer(async ({request, snapshot, store, tunnel}) => {
        const port = await getFreePort();
        expect((await request("POST", "/api/tunnelingOption", {forwardPort: port, protocol: "tcp", destinationAddress: "127.0.0.1",
            destinationPort: 9, keepAlive: 0, expectedRevision: (await snapshot()).revisionState.currentRevision})).statusCode).toBe(200);
        const before = await snapshot();
        const thrower = throwAfterApply(tunnel, "applyTunnelingOption");
        try {
            const failed = await request("POST", "/api/tunnelingOption", {forwardPort: port, protocol: "tcp", destinationAddress: "127.0.0.1",
                destinationPort: 10, keepAlive: 0, expectedRevision: before.revisionState.currentRevision});
            expect(thrower.calls()).toBe(1);
            expect(failed.statusCode).toBe(400);
            expect(JSON.parse(failed.body)).toMatchObject({success: false});
            expect(failed.body).not.toContain(SECRET_TEXT);
            expect(store.getTunnelingOption(port)?.destinationPort).toBe(9);
            expect(store.revisionState.currentRevision).toBe(before.revisionState.currentRevision);
        } finally { thrower.restore(); }
    }));

    test("an external certificate save rolls back the stored certificate (AC-4)", async () => withConfigurationServer(async ({request, snapshot, tunnel}) => {
        const port = await getFreePort();
        const cert = (name: string) => { const bundle = generateSelfSignedCert(name);
            return {key: {name: `${name}.key`, value: bundle.keyPem}, cert: {name: `${name}.crt`, value: bundle.certPem}, ca: {name: "", value: ""}}; };
        expect((await request("POST", `/api/externalCert/${port}`, {certInfo: cert("throw-original")})).statusCode).toBe(200);
        expect((await request("POST", "/api/tunnelingOption", {forwardPort: port, protocol: "tcp", tls: true, destinationAddress: "127.0.0.1",
            destinationPort: 9, expectedRevision: (await snapshot()).revisionState.currentRevision})).statusCode).toBe(200);
        const baselineCert = CertificationStore.instance.getExternalCert(port);
        const baselineRevision = CertificationStore.instance.revisionState.currentRevision;
        const thrower = throwAfterApply(tunnel, "applyExternalServerCert");
        try {
            const failed = await request("POST", `/api/externalCert/${port}`, {certInfo: cert("throw-replacement")});
            expect(thrower.calls()).toBe(1);
            expect(failed.statusCode).toBe(400);
            expect(JSON.parse(failed.body)).toMatchObject({success: false});
            expect(failed.body).not.toContain(SECRET_TEXT);
            expect(CertificationStore.instance.getExternalCert(port)).toEqual(baselineCert);
            expect(CertificationStore.instance.revisionState.currentRevision).toBe(baselineRevision);
        } finally { thrower.restore(); }
    }));

    // 리뷰 1회차: 신뢰 클라이언트 레지스트리를 바꾼 뒤(적용 도중) 예외가 나도 레지스트리를 되돌린다.
    test("a trusted client save that throws mid-apply restores the running registry (AC-2, mid-apply)", async () => withConfigurationServer(async ({request, snapshot, store, tunnel}) => {
        const before = await snapshot();
        const control = (tunnel as any).tunnelServer;
        const ttl = jest.spyOn(control, "configureSessionTtl").mockImplementationOnce(() => { throw new Error(SECRET_TEXT); });
        try {
            const failed = await request("POST", "/api/trustedClients", {clientId: "edge-mid", displayName: "Edge",
                expectedRevision: before.revisionState.currentRevision});
            expect(ttl).toHaveBeenCalled();
            expect(failed.statusCode).toBe(500);
            expect(failed.body).not.toContain(SECRET_TEXT);
            expect(store.revisionState.currentRevision).toBe(before.revisionState.currentRevision);
            expect(control._identityRegistry.findTrustedClient("edge-mid")).toBeUndefined();
        } finally { ttl.mockRestore(); }
    }));

    // 리뷰 1회차: 감사 싱크(보존·큐)도 실행 상태다. 적용 뒤 예외가 나면 이전 설정의 싱크로 되돌린다.
    test("a server option save that throws restores the audit sink options", async () => withConfigurationServer(async ({request, snapshot, tunnel}) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-throw-audit-"));
        const sink = new FileAuditSink({dir, queueSize: 1000, retentionDays: 90});
        AuditSinkRegistry.set(sink);
        const thrower = throwAfterApply(tunnel);
        try {
            const read = await snapshot();
            const failed = await request("POST", "/api/serverOption", {...read.serverOption, auditQueueSize: 2000, auditRetentionDays: 30,
                expectedRevision: read.revisionState.currentRevision});
            expect(thrower.calls()).toBe(1);
            expect(failed.statusCode).toBe(400);
            const current = AuditSinkRegistry.current() as FileAuditSink;
            expect({queue: current.queueSize, retention: current.retentionDays}).toEqual({queue: 1000, retention: 90});
        } finally {
            thrower.restore();
            await (AuditSinkRegistry.current() as any).close?.();
            AuditSinkRegistry.reset();
            fs.rmSync(dir, {recursive: true, force: true});
        }
    }));

    // 리뷰 1회차: 터널 삭제도 리스너를 멈추다 예외가 나면 삭제를 되돌린다.
    test("a tunnel delete whose listener stop throws restores the tunnel", async () => withConfigurationServer(async ({request, snapshot, store, tunnel}) => {
        const port = await getFreePort();
        expect((await request("POST", "/api/tunnelingOption", {forwardPort: port, protocol: "tcp", destinationAddress: "127.0.0.1",
            destinationPort: 9, keepAlive: 0, expectedRevision: (await snapshot()).revisionState.currentRevision})).statusCode).toBe(200);
        expect(tunnel.externalServerStatus(port).online).toBe(true);
        const before = await snapshot();
        const stop = jest.spyOn(tunnel, "stopExternalPortServer").mockImplementationOnce(async () => { throw new Error(SECRET_TEXT); });
        try {
            const failed = await request("DELETE", "/api/tunnelingOption", {forwardPort: port, expectedRevision: before.revisionState.currentRevision});
            expect(stop).toHaveBeenCalled();
            expect(failed.statusCode).toBe(400);
            expect(failed.body).not.toContain(SECRET_TEXT);
            expect(store.getTunnelingOption(port)).toBeDefined();
            expect(store.revisionState.currentRevision).toBe(before.revisionState.currentRevision);
        } finally { stop.mockRestore(); }
    }));

    // 리뷰 2회차: 복원 때 신뢰 클라이언트를 다시 넣다가 또 예외가 나도 나머지 복원과 실패 응답은 이어져야 한다.
    test("a trusted client restore that throws again is reported as a partial rollback, not a crash", async () => withConfigurationServer(async ({request, snapshot, store, tunnel}) => {
        const before = await snapshot();
        const control = (tunnel as any).tunnelServer;
        const update = control.updateTrustedClients.bind(control);
        const spy = jest.spyOn(control, "updateTrustedClients").mockImplementation((clients: any) => { update(clients); throw new Error(SECRET_TEXT); });
        try {
            const failed = await request("POST", "/api/trustedClients", {clientId: "edge-twice", displayName: "Edge",
                expectedRevision: before.revisionState.currentRevision});
            expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
            expect(failed.statusCode).toBe(500);
            const body = JSON.parse(failed.body);
            expect(body).toMatchObject({success: false, message: "Unable to apply trusted clients."});
            expect(body.failedScopes).toEqual(expect.arrayContaining(["server-runtime", "trusted-clients-restore"]));
            expect(failed.body).not.toContain(SECRET_TEXT);
            expect(store.revisionState.currentRevision).toBe(before.revisionState.currentRevision);
        } finally { spy.mockRestore(); }
    }));

    // 리뷰 3회차: 복원에서 다시 넣기가 실패해 레지스트리가 거부된 목록에 남으면, 다음에 성공하는 저장(관계없는 값이라도)이
    // 저장된 목록으로 고친 뒤에야 플래그를 지운다. 그러지 않으면 롤백한 클라이언트가 계속 인증될 수 있다.
    test("a later successful save repairs a registry left on the rejected list by a failed restore", async () => withConfigurationServer(async ({request, snapshot, tunnel}) => {
        const control = (tunnel as any).tunnelServer;
        const update = control.updateTrustedClients.bind(control);
        // 적용: 새 목록을 넣은 뒤 던진다. 복원: 넣지 않고 던진다(레지스트리가 거부된 목록에 남는다).
        const spy = jest.spyOn(control, "updateTrustedClients").mockImplementation((clients: any) => {
            if((clients as any[]).some((client) => client.clientId === "edge-stuck")) update(clients);
            throw new Error(SECRET_TEXT);
        });
        const before = await snapshot();
        try {
            const failed = await request("POST", "/api/trustedClients", {clientId: "edge-stuck", displayName: "Edge",
                expectedRevision: before.revisionState.currentRevision});
            expect(failed.statusCode).toBe(500);
            expect(control._identityRegistry.findTrustedClient("edge-stuck")).toBeDefined();
        } finally { spy.mockRestore(); }
        const read = await snapshot();
        expect((await request("POST", "/api/serverOption", {...read.serverOption, logLevel: "warn",
            expectedRevision: read.revisionState.currentRevision})).statusCode).toBe(200);
        expect(control._identityRegistry.findTrustedClient("edge-stuck")).toBeUndefined();
    }));
});
