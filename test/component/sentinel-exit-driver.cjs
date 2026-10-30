// Deliberate process-boundary fixture: liveness checks (signal 0) are answered by the fixture and every
// other signal request is recorded, never forwarded to the OS. process.exit is real.
// #207: the sentinel checks the app with process.kill(pid, 0) instead of a process-table lookup.
const fs = require("node:fs");
const path = require("node:path");
const journal = process.argv[2];
const mode = process.argv[3];
const rootDir = process.argv[4];
const record = (event) => fs.appendFileSync(journal, JSON.stringify(event) + "\n");

record({kind: "start", pid: process.pid});
let lookups = 0;
process.kill = (pid, signal) => {
    if(signal === 0) {
        record({kind: "lookup", lookupKind: "pid", pid});
        if(mode === "gone" || mode === "gone-restart") throw Object.assign(new Error("no such process"), {code: "ESRCH"});
        lookups++;
        if(lookups === 2) setImmediate(() => process.exit(0));
        return true;
    }
    record({kind: "signal", pid, signal: signal || "SIGTERM"});
    return true;
};
process.on("exit", (code) => record({kind: "exit", code}));
setTimeout(() => {
    record({kind: "watchdog"});
    process.exit(90);
}, 15000).unref();

// #222: 다시 띄우기는 실제 프로세스를 만들지 않고 기록만 한다.
const childProcess = require("node:child_process");
childProcess.spawn = (command, args, options) => {
    record({kind: "exec", mode: options && options.env && options.env.EXECUTE_MODE});
    setImmediate(() => process.exit(0));
    return {pid: 424242, unref() {}, on() { return this; }, once() { return this; }};
};

if(rootDir) require("../../src/Environment").default.configure({rootDir});
process.env.APP_PID = String(process.pid);
const Sentinel = require("../../src/Sentinel").default;
new Sentinel().runSentinel();
