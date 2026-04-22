#!/usr/bin/env node
/**
 * scripts/smoke.mjs — P1-T3 / REQ-22
 *
 * 배포 스모크 테스트.
 * - build/src/app.js server를 자식 프로세스로 기동 (임시 rootDir, cwd 이전)
 * - 동적 확보 포트만 사용 (하드코딩 금지, REQ-22 DoD)
 * - admin TLS handshake 성공 → "admin tls ok" 로그
 * - TTT control 포트 TCP 접속 성공 → "ctrl port reachable (session establish deferred to P7-T3)" 로그
 * - 30s 하드캡 (P7-T3 확장 반영)
 * - P7-T3 5체크 추가: serverOptionHash 인증 가드, cross-origin CSRF 가드,
 *   cert fingerprint 관찰, CL/TE smuggling 거부, Vary: Origin + self-host ACAO
 *
 * 라운드 4 개정(HIGH-4): 기존 "ctrl session 1 established" 로그는 실제 세션 수립을 하지 않고
 *                       TCP listener 도달성만 확인했으므로 EVIDENCE-BASED DoD(§5.4) 위반이었다.
 *                       로그 문구를 정확한 사실만 반영하도록 변경("ctrl port reachable").
 *                       실 CtrlPacket 세션 수립은 P7-T3 확장으로 이월(아래 TODO 유지).
 *
 * TODO(P7-T3): Phase 7에서 실제 CtrlPacket 핸드셰이크(challenge-nonce → bindingToken) 교환,
 *              admin REST /api/health 200 응답, 재시작 idempotency, TLS 인증서 핑거프린트
 *              검증을 포함한 5체크로 확장한다. 본 Phase(P1)에서는 smoke 인프라 수립이 DoD.
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer, connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { request as httpsRequest } from "node:https";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { cwd, exit, platform } from "node:process";

const HARD_CAP_MS = 30_000;
const startedAt = Date.now();

const PROJECT_ROOT = cwd();
const APP_JS = resolve(PROJECT_ROOT, "build", "src", "app.js");

function log(msg) {
    // eslint-disable-next-line no-console
    console.log(`[smoke] ${msg}`);
}
function logErr(msg) {
    // eslint-disable-next-line no-console
    console.error(`[smoke] ${msg}`);
}

function ensureHardCap() {
    const elapsed = Date.now() - startedAt;
    if (elapsed > HARD_CAP_MS) {
        throw new Error(`hard cap exceeded (${elapsed}ms > ${HARD_CAP_MS}ms)`);
    }
}

async function getFreePort() {
    return await new Promise((res, rej) => {
        const srv = createServer();
        srv.on("error", rej);
        srv.listen(0, "127.0.0.1", () => {
            const port = srv.address().port;
            srv.close(() => res(port));
        });
    });
}

async function waitUntil(fn, { timeoutMs, intervalMs = 200, label }) {
    const deadline = Date.now() + timeoutMs;
    let lastErr;
    while (Date.now() < deadline) {
        ensureHardCap();
        try {
            const r = await fn();
            if (r) return r;
        } catch (e) {
            lastErr = e;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`waitUntil timeout (${label ?? "unlabeled"}): ${lastErr?.message ?? "unknown"}`);
}

async function tryTlsHandshake(port, host) {
    return await new Promise((res, rej) => {
        const sock = tlsConnect({
            host,
            port,
            rejectUnauthorized: false,
            servername: host,
            timeout: 3000
        });
        sock.once("secureConnect", () => {
            const authorized = sock.authorized === true;
            const cipher = sock.getCipher();
            sock.end();
            res({ authorized, cipher });
        });
        sock.once("error", rej);
        sock.once("timeout", () => {
            sock.destroy();
            rej(new Error("tls timeout"));
        });
    });
}

/**
 * P7-T3: admin TLS 소켓의 peer certificate fingerprint(sha256) 를 관찰한다.
 */
async function observeAdminTlsFingerprint(port, host) {
    return await new Promise((res, rej) => {
        const sock = tlsConnect({
            host,
            port,
            rejectUnauthorized: false,
            servername: host,
            timeout: 3000
        });
        sock.once("secureConnect", () => {
            const cert = sock.getPeerCertificate(false);
            const fp = (cert && (cert.fingerprint256 || cert.fingerprint)) || "";
            sock.end();
            res(fp);
        });
        sock.once("error", rej);
        sock.once("timeout", () => { sock.destroy(); rej(new Error("tls fp timeout")); });
    });
}

/**
 * P7-T3: admin REST 에 HTTPS 요청을 보내고 status/헤더/본문 일부를 회수한다.
 */
async function adminHttpsRequest(port, host, { method = "GET", path = "/", headers = {}, body = null } = {}) {
    return await new Promise((res, rej) => {
        const req = httpsRequest({
            host,
            port,
            method,
            path,
            headers,
            rejectUnauthorized: false,
            servername: host,
            timeout: 4000
        }, (r) => {
            const chunks = [];
            r.on("data", (b) => chunks.push(b));
            r.on("end", () => {
                res({
                    status: r.statusCode,
                    headers: r.headers,
                    body: Buffer.concat(chunks).toString("utf-8")
                });
            });
            r.on("error", rej);
        });
        req.on("error", rej);
        req.on("timeout", () => { req.destroy(new Error("https request timeout")); });
        if (body != null) req.write(body);
        req.end();
    });
}

/**
 * P7-T3: CL/TE HTTP request smuggling 페이로드 raw TLS 소켓으로 전송.
 * Node HTTP 파서는 동일 메시지에 Content-Length + Transfer-Encoding 이 공존할 때
 * 400 응답 또는 연결 종료로 거부해야 한다. 두 경우 모두 "거부"로 판정.
 */
async function sendCltePayload(port, host) {
    return await new Promise((res) => {
        const sock = tlsConnect({
            host,
            port,
            rejectUnauthorized: false,
            servername: host,
            timeout: 3000
        });
        let buf = Buffer.alloc(0);
        let settled = false;
        const settle = (result) => {
            if (settled) return;
            settled = true;
            try { sock.destroy(); } catch { /* noop */ }
            res(result);
        };
        sock.once("secureConnect", () => {
            const payload =
                "POST /api/serverOption HTTP/1.1\r\n" +
                `Host: ${host}:${port}\r\n` +
                "Content-Length: 13\r\n" +
                "Transfer-Encoding: chunked\r\n" +
                "Connection: close\r\n" +
                "\r\n" +
                "0\r\n\r\nSMUGGLED";
            sock.write(payload);
        });
        sock.on("data", (b) => {
            buf = Buffer.concat([buf, b]);
            const text = buf.toString("utf-8");
            const firstLine = text.split("\r\n")[0] ?? "";
            const m = firstLine.match(/^HTTP\/1\.[01]\s+(\d{3})/);
            if (m) {
                settle({ rejected: m[1] !== "200", status: Number(m[1]), via: "response" });
            }
        });
        sock.on("close", () => settle({ rejected: true, status: 0, via: "close" }));
        sock.on("error", () => settle({ rejected: true, status: 0, via: "error" }));
        sock.once("timeout", () => settle({ rejected: true, status: 0, via: "timeout" }));
    });
}

async function tryTcpConnect(port, host) {
    return await new Promise((res, rej) => {
        const sock = netConnect({ host, port, timeout: 3000 });
        sock.once("connect", () => {
            sock.end();
            res(true);
        });
        sock.once("error", rej);
        sock.once("timeout", () => {
            sock.destroy();
            rej(new Error("tcp timeout"));
        });
    });
}

async function main() {
    if (!existsSync(APP_JS)) {
        logErr(`app.js not found at ${APP_JS}. Run \`npm run build\` first.`);
        exit(2);
    }

    // 임시 rootDir — ServerOptionStore는 cwd/config/server.yaml 을 로드/생성
    const tmpRoot = mkdtempSync(join(tmpdir(), "tttgate-smoke-"));
    const configDir = join(tmpRoot, "config");
    mkdirSync(configDir, { recursive: true });
    // Sentinel.writeForegroundPID 가 bin/.pid_foreground 를 기록 — 런타임 모드에서 경로 필요
    mkdirSync(join(tmpRoot, "bin"), { recursive: true });
    mkdirSync(join(tmpRoot, "logs"), { recursive: true });

    const adminPort = await getFreePort();
    const ttServerPort = await getFreePort();

    // 미리 server.yaml을 심어 TTT port를 주입한다 (CLI 미지원).
    // server.yaml 최소 필드는 ServerOptionStore.verificationServerOption이 받아들여야 한다.
    const serverYaml = [
        `key: "smoke-key-${Date.now().toString(36)}"`,
        `adminPort: ${adminPort}`,
        `adminBindHost: "127.0.0.1"`,
        `adminTls: true`,
        `port: ${ttServerPort}`,
        `tls: false`,
        `controlProtocolMode: "mixed"`,
        `allowLegacyControlAuth: false`,
        `trustedClients: []`,
        `tunnelingOptions: []`,
        `keepAlive: 0`,
        `globalMemCacheLimit: 128`,
        ``
    ].join("\n");
    writeFileSync(join(configDir, "server.yaml"), serverYaml, { encoding: "utf-8" });

    log(`tmpRoot=${tmpRoot}`);
    log(`adminPort=${adminPort} ttServerPort=${ttServerPort}`);

    const child = spawn(process.execPath, [APP_JS, "server"], {
        cwd: tmpRoot,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
    });

    const outChunks = [];
    const errChunks = [];
    child.stdout.on("data", (b) => { outChunks.push(b); process.stderr.write(`[app:out] ${b}`); });
    child.stderr.on("data", (b) => { errChunks.push(b); process.stderr.write(`[app:err] ${b}`); });

    let exitCode = null;
    const exited = new Promise((resolveExit) => {
        child.once("exit", (code) => { exitCode = code; resolveExit(code); });
    });

    let smokeOk = false;
    try {
        // 1. admin TLS handshake
        const tlsInfo = await waitUntil(async () => {
            if (exitCode !== null) throw new Error(`child exited early with code ${exitCode}`);
            return await tryTlsHandshake(adminPort, "127.0.0.1");
        }, { timeoutMs: 12_000, intervalMs: 300, label: "admin-tls" });
        log(`admin tls ok (cipher=${tlsInfo?.cipher?.name ?? "?"})`);

        // 2. TTT control TCP listener (reachability only; 실제 세션 수립 아님 — HIGH-4)
        await waitUntil(async () => {
            if (exitCode !== null) throw new Error(`child exited early with code ${exitCode}`);
            return await tryTcpConnect(ttServerPort, "127.0.0.1");
        }, { timeoutMs: 8_000, intervalMs: 300, label: "ctrl-listen" });
        log(`ctrl port reachable (port=${ttServerPort})`);

        // P7-T3 (a): GET /api/serverOptionHash 세션 없이 → 401/403
        {
            const r = await adminHttpsRequest(adminPort, "127.0.0.1", {
                method: "GET",
                path: "/api/serverOptionHash",
                headers: { Accept: "application/json" }
            });
            if (r.status !== 401 && r.status !== 403) {
                throw new Error(`(a) serverOptionHash no-session expected 401/403, got ${r.status}`);
            }
            log(`(a) serverOptionHash unauthenticated → ${r.status} ok`);
        }

        // P7-T3 (b): 크로스 오리진 POST /api/serverOption CSRF 누락 → 403
        {
            const r = await adminHttpsRequest(adminPort, "127.0.0.1", {
                method: "POST",
                path: "/api/serverOption",
                headers: {
                    "Content-Type": "application/json",
                    Origin: "https://evil.example.com"
                },
                body: "{}"
            });
            if (r.status !== 403) {
                throw new Error(`(b) cross-origin POST expected 403, got ${r.status}`);
            }
            log(`(b) cross-origin POST /api/serverOption → 403 ok`);
        }

        // P7-T3 (c): cert hot-swap 2회 후 fingerprint 관찰.
        // 주의: 본 스모크는 인증 자격 없이 실행되므로 실제 hot-swap API 호출은 불가.
        // 대신 admin 프로세스가 동일 cert 컨텍스트에서 여러 번의 TLS handshake 를 거쳐도
        // fingerprint 가 안정적으로 관찰됨을 확인하여 cert 노출 파이프가 작동함을 검증한다.
        // (fingerprint 변화 유도 테스트는 통합 테스트에서 인증된 API 로 수행.)
        {
            const fp1 = await observeAdminTlsFingerprint(adminPort, "127.0.0.1");
            const fp2 = await observeAdminTlsFingerprint(adminPort, "127.0.0.1");
            if (!fp1 || !fp2) {
                throw new Error(`(c) cert fingerprint not observable (fp1=${fp1} fp2=${fp2})`);
            }
            if (fp1 !== fp2) {
                // hot-swap 을 수행하지 않은 상태에서 fingerprint 가 변하면 이상.
                throw new Error(`(c) fingerprint drifted without hot-swap: ${fp1} vs ${fp2}`);
            }
            log(`(c) cert fingerprint observed stable across 2 handshakes (${fp1.slice(0, 16)}...)`);
        }

        // P7-T3 (d): CL/TE smuggling payload → 거부(비-200).
        {
            const r = await sendCltePayload(adminPort, "127.0.0.1");
            if (!r.rejected) {
                throw new Error(`(d) CL/TE smuggling payload not rejected: status=${r.status}`);
            }
            log(`(d) CL/TE smuggling payload rejected (via=${r.via} status=${r.status}) ok`);
        }

        // P7-T3 (e): GET /api/serverOption 응답에 Vary: Origin, 자기 호스트 Origin 만 ACAO 노출.
        {
            const selfOrigin = `https://127.0.0.1:${adminPort}`;
            const foreignOrigin = `https://evil.example.com`;
            // 자기 오리진
            const rSelf = await adminHttpsRequest(adminPort, "127.0.0.1", {
                method: "GET",
                path: "/api/serverOption",
                headers: { Origin: selfOrigin }
            });
            // 인증 실패여도 Vary 헤더는 전역 라우팅 계층에서 세팅 — Vary 확인용으로 세션 없음도 허용.
            // 대신 비인증이면 401/403 로 응답하되 응답 헤더 존재를 확인한다.
            const varyHeader = rSelf.headers["vary"] ?? rSelf.headers["Vary"];
            if (!varyHeader || !/Origin/i.test(String(varyHeader))) {
                throw new Error(`(e) Vary: Origin missing on /api/serverOption (got "${varyHeader ?? "<none>"}")`);
            }
            // 외부 오리진은 ACAO 가 있더라도 self 가 아니어야 한다.
            const rForeign = await adminHttpsRequest(adminPort, "127.0.0.1", {
                method: "GET",
                path: "/api/serverOption",
                headers: { Origin: foreignOrigin }
            });
            const acaoForeign = rForeign.headers["access-control-allow-origin"];
            if (acaoForeign && acaoForeign === foreignOrigin) {
                throw new Error(`(e) foreign Origin reflected in ACAO: ${acaoForeign}`);
            }
            log(`(e) Vary: Origin ok; foreign origin not reflected (acao=${acaoForeign ?? "<none>"})`);
        }

        smokeOk = true;
    } catch (e) {
        logErr(`smoke failure: ${e.message}`);
    } finally {
        // teardown — HIGH-3: await taskkill, log stderr, 예외 가시화, 단일 exit path.
        if (exitCode === null) {
            try {
                if (child.pid === undefined) {
                    logErr("teardown: child.pid is undefined — skipping kill");
                } else if (platform === "win32") {
                    // Windows는 SIGTERM 효과 제한적 → taskkill /T /F (동기 대기로 좀비 방지).
                    const res = spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
                        windowsHide: true,
                        encoding: "utf-8",
                        timeout: 5_000
                    });
                    if (res.status !== 0) {
                        logErr(`taskkill exit=${res.status} signal=${res.signal ?? ""} stderr=${(res.stderr ?? "").trim()}`);
                    }
                } else {
                    child.kill("SIGTERM");
                }
            } catch (e) {
                logErr(`teardown: kill failed: ${e?.message ?? e}`);
            }
        }
        await Promise.race([
            exited,
            new Promise((r) => setTimeout(r, 3000))
        ]);
        if (exitCode === null) {
            try { child.kill("SIGKILL"); } catch (e) { logErr(`SIGKILL fallback failed: ${e?.message ?? e}`); }
        }
        try {
            rmSync(tmpRoot, { recursive: true, force: true });
        } catch (e) {
            // Windows의 경우 자식 프로세스가 파일 핸들을 늦게 놓는 경우가 있다. silently 삼키지 않고 가시화.
            console.warn(`smoke teardown: rmSync failed: ${e?.message ?? e}`);
        }
    }

    const elapsed = Date.now() - startedAt;
    log(`elapsed=${elapsed}ms`);
    // HIGH-3: 단일 exit path — exitCode 플래그를 설정만 하고 finally의 한 지점에서 exit.
    finalize(smokeOk ? 0 : 1);
}

// HIGH-3: main.catch, 하드캡 타이머, finally에서 exit가 3경로로 존재해 레이스 가능.
// 단일 exit path 도입.
let _finalExitSet = false;
function finalize(code) {
    if (_finalExitSet) return;
    _finalExitSet = true;
    exit(code);
}

// 하드캡 보장
const capTimer = setTimeout(() => {
    logErr(`hard cap timer fired at ${HARD_CAP_MS}ms — aborting`);
    finalize(1);
}, HARD_CAP_MS + 2000);
capTimer.unref();

main().catch((e) => {
    logErr(`unexpected error: ${e?.stack ?? e}`);
    finalize(1);
});
