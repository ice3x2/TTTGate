import {spawnSync} from "child_process";
import {readAuditReport, readDependencyTree} from "../helpers/SupplyChainGate";

// These are protocol fixtures emitted by real Node child processes, not npm audits.
const emit = (body: unknown, status = 0) => spawnSync(process.execPath,
    ["-e", "process.stdout.write(process.argv[1]); process.exit(Number(process.argv[2]))",
        typeof body === "string" ? body : JSON.stringify(body), String(status)], {encoding: "utf8"});
const report = (vulnerabilities = {}) => ({auditReportVersion: 2, vulnerabilities,
    metadata: {vulnerabilities: {info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0}}});

describe("supply-chain command result validation", () => {
    test("accepts a successful complete audit", () => {
        expect(readAuditReport(emit(report())).vulnerabilities).toEqual({});
    });
    test("retains vulnerabilities from npm's documented exit 1 report", () => {
        const vulnerable = report({"fixture-vulnerable": {severity: "critical"}});
        vulnerable.metadata.vulnerabilities.critical = 1;
        vulnerable.metadata.vulnerabilities.total = 1;
        expect(readAuditReport(emit(vulnerable, 1)).vulnerabilities["fixture-vulnerable"].severity)
            .toBe("critical");
    });
    test.each(["", "{}", "not json", "null", "[]",
        JSON.stringify({error: {code: "ECONNREFUSED"}}),
        JSON.stringify({...report(), error: {code: "E503"}}),
        JSON.stringify({...report(), vulnerabilities: []}),
    ])("rejects incomplete/error audit output %s", (body) => {
        expect(() => readAuditReport(emit(body, 1))).toThrow();
    });
    test("rejects process failure even with a valid report", () => {
        expect(() => readAuditReport(emit(report(), 2))).toThrow();
    });
    test("rejects exit 1 without vulnerabilities instead of treating it as a clean audit", () => {
        expect(() => readAuditReport(emit(report(), 1))).toThrow();
    });
    test("rejects counts that conceal missing vulnerability entries", () => {
        const incomplete = report();
        incomplete.metadata.vulnerabilities.total = 1;
        incomplete.metadata.vulnerabilities.high = 1;
        expect(() => readAuditReport(emit(incomplete))).toThrow();
    });
    test("rejects spawn errors", () => {
        expect(() => readAuditReport(spawnSync("tttgate-nonexistent-command-15", [], {encoding: "utf8"}))).toThrow();
    });
    test("rejects timeout even after valid output", () => {
        const result = spawnSync(process.execPath,
            ["-e", "console.log(process.argv[1]); setInterval(() => {}, 1000)", JSON.stringify(report())],
            {encoding: "utf8", timeout: 300});
        expect(() => readAuditReport(result)).toThrow();
    });
    test.each(["", "{}", "null", "not json", JSON.stringify({name: "fixture", error: {code: "EFAIL"}})])(
        "rejects empty/invalid dependency output %s", (body) => {
            expect(() => readDependencyTree(emit(body))).toThrow();
        });
    test("rejects failed npm ls even with a tree", () => {
        expect(() => readDependencyTree(emit({name: "fixture", dependencies: {}}, 1))).toThrow();
    });
    test("accepts an explicitly empty named dependency tree", () => {
        expect(readDependencyTree(emit({name: "fixture", dependencies: {}})).dependencies).toEqual({});
    });
});
