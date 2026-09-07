const {spawnSync} = require("child_process");

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const readJson = (result, allowedStatuses) => {
    if(result.error || result.signal || result.status === null || !allowedStatuses.includes(result.status)) {
        throw new Error(`Supply-chain command failed (status ${result.status}): ${result.error?.message || result.signal || result.stderr}`);
    }
    if(!result.stdout?.trim()) throw new Error("Supply-chain command returned empty output");
    const parsed = JSON.parse(result.stdout);
    if(!isObject(parsed) || parsed.error) throw new Error(`Invalid supply-chain result: ${result.stdout}`);
    return parsed;
};

const readAuditReport = (result) => {
    // npm audit exits 1 for a completed audit that found vulnerabilities.
    // Registry/process errors also use 1, so a complete report is mandatory.
    const report = readJson(result, [0, 1]);
    const counts = report.metadata?.vulnerabilities;
    const severities = ["info", "low", "moderate", "high", "critical"];
    if(report.auditReportVersion !== 2 || !isObject(report.vulnerabilities) || !isObject(counts) ||
        ![...severities, "total"].every((key) => Number.isInteger(counts[key]) && counts[key] >= 0) ||
        !Object.values(report.vulnerabilities).every((entry) => isObject(entry) && severities.includes(entry.severity))) {
        throw new Error(`Incomplete npm audit report: ${result.stdout}`);
    }
    const entries = Object.values(report.vulnerabilities);
    if(counts.total !== entries.length || severities.some((severity) =>
        counts[severity] !== entries.filter((entry) => entry.severity === severity).length) ||
        (result.status === 1 && counts.total === 0)) {
        throw new Error(`Inconsistent npm audit report: ${result.stdout}`);
    }
    return report;
};

const readDependencyTree = (result) => {
    // Query the entire production tree: unlike a filtered npm ls, success is 0
    // even when the prohibited package is absent.
    const tree = readJson(result, [0]);
    if(typeof tree.name !== "string" || tree.name.length === 0 ||
        (tree.dependencies !== undefined && !isObject(tree.dependencies)) || tree.problems?.length) {
        throw new Error(`Incomplete npm dependency tree: ${result.stdout}`);
    }
    return tree;
};

const runNpm = (args, cwd = process.cwd()) => spawnSync("npm", args, {
    cwd, encoding: "utf8", shell: process.platform === "win32",
    timeout: 45_000, maxBuffer: 10 * 1024 * 1024,
    env: {...process.env, NODE_ENV: "development"},
});

module.exports = {readAuditReport, readDependencyTree, runNpm};

if(require.main === module) {
    if(process.argv[2] !== "--admin-high-report") throw new Error("Expected --admin-high-report");
    const report = readAuditReport(runNpm(["audit", "--audit-level=high", "--json"]));
    const entries = Object.entries(report.vulnerabilities);
    const critical = entries.filter(([, entry]) => entry.severity === "critical").map(([name]) => name);
    if(critical.length) throw new Error(`CRITICAL admin advisories: ${critical.join(", ")}`);
    const high = entries.filter(([, entry]) => entry.severity === "high").map(([name]) => name);
    if(high.length) console.log(`::warning::admin HIGH advisories (report only): ${high.join(", ")}`);
    else console.log("No admin HIGH advisories");
}
