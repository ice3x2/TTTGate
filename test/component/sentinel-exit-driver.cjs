// Deliberate process-boundary fixture: lookup results are injected and every
// signal request is recorded, never forwarded to the OS. process.exit is real.
const fs = require("node:fs");
const journal = process.argv[2];
const mode = process.argv[3];
const record = (event) => fs.appendFileSync(journal, JSON.stringify(event) + "\n");

record({kind: "start", pid: process.pid});
process.kill = (pid, signal) => {
    record({kind: "signal", pid, signal: signal || "SIGTERM"});
    return true;
};
process.on("exit", (code) => record({kind: "exit", code}));
setTimeout(() => {
    record({kind: "watchdog"});
    process.exit(90);
}, 8000).unref();

const lookupPath = require.resolve("find-process");
require(lookupPath);
let lookups = 0;
require.cache[lookupPath].exports = (kind, pid) => {
    record({kind: "lookup", lookupKind: kind, pid});
    if(mode === "failure") return Promise.reject(new Error("fixture-lookup-failure"));
    lookups++;
    if(lookups === 2) setImmediate(() => process.exit(0));
    return Promise.resolve([{pid: process.pid}]);
};

process.env.APP_PID = String(process.pid);
const Sentinel = require("../../src/Sentinel").default;
new Sentinel().runSentinel();
