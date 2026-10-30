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

/**
 * #180: 수정 버전이 없어 업그레이드로 풀 수 없고, TTTGate 가 영향받는 API 를 쓰지 않음을 검토한 권고.
 * 서버 게이트(moderate·high)는 이 목록의 권고만 통과시킨다(#293). reviewBy 날짜의 UTC 00:00 에 만료되어 다시 막고 재검토를 강제한다.
 * reviewBy 는 reviewedOn 에서 180일 안이어야 한다(테스트가 지킨다). severity 는 검토할 때의 등급이며, 권고 등급이 그보다
 * 오르면 다시 막는다(#293). 항목 형식: {id, package, severity, reviewedOn, reviewBy, reason}.
 * 예외의 전제(영향 API 미사용)는 test/supply-chain/reviewed-advisories.test.ts 가 지킨다.
 */
// #293: GHSA-86w9-cpqp-85rv(node-forge) 는 수정 버전 1.4.1 이 나와 예외를 지우고 1.4.2 로 올렸다.
const REVIEWED_ADVISORIES = [];

const GHSA_PATTERN = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;
const SEVERITY_ORDER = ["low", "moderate", "high", "critical"];

/**
 * npm audit 보고서에서 level 이상 등급의 권고를 모아 검토 예외와 대조한다(level: moderate·high, #293).
 * 다른 패키지를 가리키는 via(문자열)는 그 패키지의 권고로 따라간다. CRITICAL 은 예외로도 통과하지 않는다.
 */
const evaluateGate = (report, level, reviewed = REVIEWED_ADVISORIES, now = Date.now()) => {
    if(!["moderate", "high"].includes(level)) throw new Error(`Unsupported gate level: ${level}`);
    const blockingSeverities = SEVERITY_ORDER.slice(SEVERITY_ORDER.indexOf(level));
    const blocking = new Set();
    const accepted = new Set();
    const vulnerabilities = report.vulnerabilities ?? {};
    const advisoriesOf = (name, seen = new Set()) => {
        if(seen.has(name)) return [];
        seen.add(name);
        const entry = vulnerabilities[name];
        if(!isObject(entry) || !Array.isArray(entry.via)) return [];
        return entry.via.flatMap((via) => typeof via === "string" ? advisoriesOf(via, seen) : isObject(via) ? [via] : []);
    };
    for(const [name, entry] of Object.entries(vulnerabilities)) {
        if(!blockingSeverities.includes(entry.severity)) continue;
        const advisories = advisoriesOf(name).filter((advisory) => blockingSeverities.includes(advisory.severity));
        // 기준 등급 이상 항목인데 그 근거 권고를 찾지 못하면(보고서에 없는 패키지를 가리킴) 통과시키지 않는다.
        if(advisories.length === 0) blocking.add(`${name} (unresolved via)`);
        for(const advisory of advisories) {
            if(!blockingSeverities.includes(advisory.severity)) continue;
            const id = GHSA_PATTERN.exec(String(advisory.url ?? ""))?.[0];
            const pkg = advisory.name ?? advisory.dependency ?? name;
            const label = `${pkg} ${id ?? advisory.title ?? "unknown advisory"}`;
            const review = id === undefined ? undefined : reviewed.find((item) => item.id.toLowerCase() === id.toLowerCase() && item.package === pkg);
            if(advisory.severity === "critical" || review === undefined) blocking.add(label);
            else if(!(Date.parse(review.reviewBy) >= now)) blocking.add(`${label} (review expired ${review.reviewBy})`);
            // 예외는 검토할 때의 등급까지만 덮는다. 등급이 올라가면(또는 적혀 있지 않으면) 다시 검토하게 막는다.
            else if(!(SEVERITY_ORDER.indexOf(advisory.severity) <= SEVERITY_ORDER.indexOf(review.severity))) {
                blocking.add(`${label} (reviewed as ${review.severity}, now ${advisory.severity})`);
            }
            else accepted.add(label);
        }
    }
    return {blocking: [...blocking], accepted: [...accepted]};
};

/** #180 서버 HIGH 게이트. evaluateGate 의 high 수준이다. */
const evaluateHighGate = (report, reviewed = REVIEWED_ADVISORIES, now = Date.now()) => evaluateGate(report, "high", reviewed, now);

module.exports = {readAuditReport, readDependencyTree, runNpm, evaluateGate, evaluateHighGate, REVIEWED_ADVISORIES};

if(require.main === module && process.argv[2] === "--server-high-gate") {
    const report = readAuditReport(runNpm(["audit", "--omit=dev", "--audit-level=high", "--json"]));
    const {blocking, accepted} = evaluateHighGate(report);
    for(const label of accepted) console.log(`::warning::reviewed advisory accepted until its review date: ${label}`);
    if(blocking.length) throw new Error(`Unreviewed HIGH/CRITICAL server advisories: ${blocking.join(", ")}`);
    console.log("No unreviewed server HIGH advisories");
} else if(require.main === module) {
    if(process.argv[2] !== "--admin-high-report") throw new Error("Expected --admin-high-report or --server-high-gate");
    const report = readAuditReport(runNpm(["audit", "--audit-level=high", "--json"]));
    const entries = Object.entries(report.vulnerabilities);
    const critical = entries.filter(([, entry]) => entry.severity === "critical").map(([name]) => name);
    if(critical.length) throw new Error(`CRITICAL admin advisories: ${critical.join(", ")}`);
    const high = entries.filter(([, entry]) => entry.severity === "high").map(([name]) => name);
    if(high.length) console.log(`::warning::admin HIGH advisories (report only): ${high.join(", ")}`);
    else console.log("No admin HIGH advisories");
}
