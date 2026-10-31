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
 * 서버 판정(moderate 이상)과 루트 전체 트리 판정(high 이상)은 이 목록의 권고만 통과시킨다(#293). 전체 트리 판정에서는
 * 서버 운영 트리에 있는 설치 경로에만 예외를 적용하므로, 빌드 도구에 든 같은 패키지는 막힌다. reviewBy 날짜의 UTC 00:00 에 만료되어 다시 막고 재검토를 강제한다.
 * reviewedOn 은 오늘 이전이고 reviewBy 는 reviewedOn 에서 180일 안이어야 한다(판정이 지킨다). severity 는 검토할 때의 등급이며, 권고 등급이 그보다
 * 오르면 다시 막는다(#293). 항목 형식: {id, package, severity, reviewedOn, reviewBy, reason}.
 * 항목을 더할 때는 그 권고의 영향 API 를 쓰지 않음을 지키는 테스트를 test/supply-chain/reviewed-advisories.test.ts 에 함께 더한다.
 */
// #293: GHSA-86w9-cpqp-85rv(node-forge) 는 수정 버전 1.4.1 이 나와 예외를 지우고 1.4.2 로 올렸다.
const REVIEWED_ADVISORIES = [];

const GHSA_PATTERN = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;
const SEVERITY_ORDER = ["low", "moderate", "high", "critical"];
const MAX_REVIEW_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 검토일이 오늘 이전이고 재검토일이 검토일에서 180일 안이어야 한다. 어기는 항목은 기한 제한을 우회하므로 막는다(#293). */
const hasValidReviewWindow = (review, now) => {
    const reviewedOn = Date.parse(review.reviewedOn);
    const reviewBy = Date.parse(review.reviewBy);
    return reviewedOn <= now && reviewBy > reviewedOn && reviewBy - reviewedOn <= MAX_REVIEW_DAYS * DAY_MS;
};

/** 설치 경로를 알 수 없으면 서버 운영 트리에 있다고 볼 수 없으므로 거짓이다. */
const isInstalledOnlyIn = (entry, serverNodes) =>
    isObject(entry) && Array.isArray(entry.nodes) && entry.nodes.length > 0 && entry.nodes.every((node) => serverNodes.has(node));

/**
 * npm audit 보고서에서 level 이상 등급의 권고를 모아 검토 예외와 대조한다(level: moderate·high, #293).
 * 다른 패키지를 가리키는 via(문자열)는 그 패키지의 권고로 따라간다. CRITICAL 은 예외로도 통과하지 않는다.
 * serverNodes 를 주면 예외는 npm audit 이 그 패키지에서 취약하다고 보고한 설치 경로(nodes)가 모두 서버 운영 트리에 있을 때만
 * 적용한다. nodes 는 권고마다가 아니라 패키지마다 합쳐 보고되므로, 다른 권고로 취약한 빌드 도구 사본이 있어도 막는다.
 */
const evaluateGate = (report, level, reviewed = REVIEWED_ADVISORIES, now = Date.now(), serverNodes = undefined) => {
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
            const id = GHSA_PATTERN.exec(String(advisory.url ?? ""))?.[0];
            const pkg = advisory.name ?? advisory.dependency ?? name;
            const label = `${pkg} ${id ?? advisory.title ?? "unknown advisory"}`;
            const review = id === undefined ? undefined : reviewed.find((item) => String(item.id ?? "").toLowerCase() === id.toLowerCase() && item.package === pkg);
            if(advisory.severity === "critical" || review === undefined) blocking.add(label);
            else if(!hasValidReviewWindow(review, now)) blocking.add(`${label} (review window invalid)`);
            else if(!(Date.parse(review.reviewBy) > now)) blocking.add(`${label} (review expired ${review.reviewBy})`);
            // 예외는 검토할 때의 등급까지만 덮는다. 등급이 적혀 있지 않거나 올라가면 다시 검토하게 막는다.
            else if(!["moderate", "high"].includes(review.severity)) blocking.add(`${label} (reviewed severity missing)`);
            else if(SEVERITY_ORDER.indexOf(advisory.severity) > SEVERITY_ORDER.indexOf(review.severity)) {
                blocking.add(`${label} (reviewed as ${review.severity}, now ${advisory.severity})`);
            }
            else if(serverNodes !== undefined && !isInstalledOnlyIn(vulnerabilities[pkg], serverNodes)) {
                blocking.add(`${label} (exception covers server runtime only)`);
            }
            else accepted.add(label);
        }
    }
    return {blocking: [...blocking], accepted: [...accepted]};
};

// 검토 예외를 쓰는 판정 명령(#293). 예외로 통과한 권고는 모두 경고로 남긴다.
// --server-gate: 서버 운영 의존성의 moderate 이상. --full-tree-gate: 빌드 도구(개발 의존성)를 포함한 루트 전체 트리의 high 이상.
const SERVER_AUDIT_ARGS = ["audit", "--omit=dev", "--audit-level=moderate", "--json"];
const GATES = {
    "--server-gate": {scope: "server", level: "moderate", args: SERVER_AUDIT_ARGS},
    "--full-tree-gate": {scope: "full-tree", level: "high", args: ["audit", "--audit-level=high", "--json"], serverTreeOnly: true},
};

/** 판정 명령 하나를 돌린다. run 은 npm 을 실행하는 함수로, 테스트가 보고서를 주입할 때 바꾼다. */
const runGate = (name, {run = runNpm, reviewed = REVIEWED_ADVISORIES, now = Date.now()} = {}) => {
    const gate = GATES[name];
    if(gate === undefined) throw new Error(`Unknown gate: ${name}`);
    const report = readAuditReport(run(gate.args));
    const serverNodes = gate.serverTreeOnly
        ? new Set(Object.values(readAuditReport(run(SERVER_AUDIT_ARGS)).vulnerabilities).flatMap((entry) => Array.isArray(entry.nodes) ? entry.nodes : []))
        : undefined;
    return {scope: gate.scope, ...evaluateGate(report, gate.level, reviewed, now, serverNodes)};
};

module.exports = {readAuditReport, readDependencyTree, runNpm, evaluateGate, runGate, REVIEWED_ADVISORIES};

if(require.main === module && GATES[process.argv[2]] !== undefined) {
    const {scope, blocking, accepted} = runGate(process.argv[2]);
    for(const label of accepted) console.log(`::warning::reviewed advisory accepted until its review date: ${label}`);
    if(blocking.length) throw new Error(`Blocked ${scope} advisories: ${blocking.join(", ")}`);
    console.log(`No blocked ${scope} advisories`);
} else if(require.main === module) {
    // 관리 화면 트리에서 critical 은 막고 high 는 경고로 남긴다.
    if(process.argv[2] !== "--high-report") throw new Error(`Expected --high-report or ${Object.keys(GATES).join(" or ")}`);
    const report = readAuditReport(runNpm(["audit", "--audit-level=high", "--json"]));
    const entries = Object.entries(report.vulnerabilities);
    const critical = entries.filter(([, entry]) => entry.severity === "critical").map(([name]) => name);
    if(critical.length) throw new Error(`CRITICAL advisories: ${critical.join(", ")}`);
    const high = entries.filter(([, entry]) => entry.severity === "high").map(([name]) => name);
    if(high.length) console.log(`::warning::HIGH advisories (report only): ${high.join(", ")}`);
    else console.log("No HIGH advisories");
}
