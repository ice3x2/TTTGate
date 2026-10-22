import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

test("real socket timeout and bind failure persist with production logging and ignored stdio", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-socket-logs-"));
    const repo = path.resolve(__dirname, "../..");
    const evidence = path.join(repo, "results/logging", `issue22-${Date.now()}`);
    try {
        const child = spawnSync(process.execPath, ["-r", "ts-node/register/transpile-only",
            path.join(__dirname, "socket-log-persistence-driver.cjs"), root], {
            cwd: repo, stdio: ["ignore", "ignore", "ignore"], timeout: 15_000, windowsHide: true,
        });
        fs.mkdirSync(path.dirname(evidence), {recursive: true});
        fs.cpSync(root, evidence, {recursive: true});
        fs.writeFileSync(path.join(evidence, "child-result.json"), JSON.stringify({pid: child.pid,
            status: child.status, signal: child.signal, error: child.error?.message}, null, 2));
        console.log(`Socket log evidence: ${evidence}`);
        expect(child.error).toBeUndefined();
        expect(child.signal).toBeNull();
        expect(child.status).toBe(0);
        expect(JSON.parse(fs.readFileSync(path.join(root, "events.json"), "utf8")))
            .toEqual({pid: child.pid, timeoutObserved: true, ownerCalls: 1, bindError: "EADDRINUSE"});
        const logs = fs.readdirSync(path.join(root, "logs"));
        const contents = (names: string[]) => names.map(name => fs.readFileSync(path.join(root, "logs", name), "utf8")).join("\n");
        expect(contents(logs.filter(name => name.startsWith("server-")))).toContain("issue22-real-file-control");
        const socketLogs = contents(logs.filter(name => name.startsWith("socket-")));
        expect({timeoutLog: /SocketHandler::.*timed out after 80ms/.test(socketLogs),
            bindLog: /TCPServer::.*EADDRINUSE/.test(socketLogs)}).toEqual({timeoutLog: true, bindLog: true});
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
}, 20_000);
