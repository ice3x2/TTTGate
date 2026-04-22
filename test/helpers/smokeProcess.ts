import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { once } from "events";
import { createServer, AddressInfo } from "net";

/**
 * smokeProcess.ts — P1-T3 / REQ-22 테스트 헬퍼.
 * 실 자식 프로세스(app.js) 기동/종료 유틸리티. Mock 금지.
 */

export interface SpawnedProcess {
    readonly child: ChildProcessWithoutNullStreams;
    readonly pid: number;
    readonly stdoutChunks: Buffer[];
    readonly stderrChunks: Buffer[];
    readChannel(): { stdout: string; stderr: string };
    waitForExit(timeoutMs: number): Promise<number | null>;
    kill(signal?: NodeJS.Signals): void;
}

export function spawnProcess(
    nodeBin: string,
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv; logPrefix?: string } = {}
): SpawnedProcess {
    const child = spawn(nodeBin, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => {
        stdoutChunks.push(b);
        if (opts.logPrefix) process.stderr.write(`[${opts.logPrefix}:out] ${b}`);
    });
    child.stderr.on("data", (b: Buffer) => {
        stderrChunks.push(b);
        if (opts.logPrefix) process.stderr.write(`[${opts.logPrefix}:err] ${b}`);
    });
    return {
        child,
        pid: child.pid ?? -1,
        stdoutChunks,
        stderrChunks,
        readChannel() {
            return {
                stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
                stderr: Buffer.concat(stderrChunks).toString("utf-8")
            };
        },
        async waitForExit(timeoutMs: number): Promise<number | null> {
            if (child.exitCode !== null) return child.exitCode;
            const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
            const exit = once(child, "exit").then((v) => (v[0] as number | null));
            const result = await Promise.race([exit, timer]);
            return result;
        },
        kill(signal: NodeJS.Signals = "SIGTERM") {
            if (child.exitCode === null) {
                try { child.kill(signal); } catch { /* noop */ }
            }
        }
    };
}

/** OS에서 즉시 해제되는 free port를 ephemeral bind(포트 0)으로 확보 */
export async function getFreePort(): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
        const srv = createServer();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const addr = srv.address() as AddressInfo;
            const port = addr.port;
            srv.close(() => resolve(port));
        });
    });
}

/** 지정한 predicate가 true가 될 때까지 polling. timeout 내 미달이면 throw. */
export async function waitUntil<T>(
    fn: () => Promise<T> | T,
    opts: { timeoutMs: number; intervalMs?: number; label?: string }
): Promise<T> {
    const interval = opts.intervalMs ?? 100;
    const deadline = Date.now() + opts.timeoutMs;
    let lastErr: unknown;
    while (Date.now() < deadline) {
        try {
            const v = await fn();
            if (v) return v as T;
        } catch (e) {
            lastErr = e;
        }
        await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`waitUntil timeout${opts.label ? `(${opts.label})` : ""}: ${lastErr ?? "no result"}`);
}
