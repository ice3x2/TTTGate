import * as fs from "fs";
import * as path from "path";

// #180 — 수정 버전이 없는 권고는 검토한 예외로만 HIGH 게이트를 통과시킨다. 그 밖의 HIGH·CRITICAL 과 기한 지난 예외는 막는다.
const repoRoot = path.resolve(__dirname, "..", "..");
const gate = require("../../scripts/supply-chain-gate.cjs");

const advisory = (name: string, severity: string, ghsa: string) =>
    ({source: 1, name, dependency: name, title: `${name} advisory`, url: `https://github.com/advisories/${ghsa}`, severity, range: "*"});
const reportOf = (vulnerabilities: Record<string, any>) => ({auditReportVersion: 2, vulnerabilities});
const REVIEWED = [{id: "GHSA-aaaa-bbbb-cccc", package: "forge", severity: "high", reviewBy: "2027-01-31", reason: "unused API"}];
const NOW = Date.parse("2026-10-19T00:00:00Z");

describe("server HIGH gate with reviewed advisories (#180)", () => {
    it("passes when every HIGH advisory is reviewed and not expired", () => {
        const result = gate.evaluateGate(reportOf({forge: {name: "forge", severity: "high", via: [advisory("forge", "high", "GHSA-aaaa-bbbb-cccc")]}}), "high", REVIEWED, NOW);
        expect(result.blocking).toEqual([]);
        expect(result.accepted).toEqual(["forge GHSA-aaaa-bbbb-cccc"]);
    });

    it("blocks an unreviewed HIGH advisory, also next to a reviewed one", () => {
        const result = gate.evaluateGate(reportOf({forge: {name: "forge", severity: "high",
            via: [advisory("forge", "high", "GHSA-aaaa-bbbb-cccc"), advisory("forge", "high", "GHSA-dddd-eeee-ffff")]}}), "high", REVIEWED, NOW);
        expect(result.blocking).toEqual(["forge GHSA-dddd-eeee-ffff"]);
    });

    it("blocks a reviewed advisory on another package and any CRITICAL", () => {
        expect(gate.evaluateGate(reportOf({other: {name: "other", severity: "high", via: [advisory("other", "high", "GHSA-aaaa-bbbb-cccc")]}}), "high", REVIEWED, NOW).blocking)
            .toEqual(["other GHSA-aaaa-bbbb-cccc"]);
        expect(gate.evaluateGate(reportOf({forge: {name: "forge", severity: "critical", via: [advisory("forge", "critical", "GHSA-aaaa-bbbb-cccc")]}}), "high", REVIEWED, NOW).blocking)
            .toEqual(["forge GHSA-aaaa-bbbb-cccc"]);
    });

    it("blocks a reviewed advisory after its review date", () => {
        const later = Date.parse("2027-02-01T00:00:00Z");
        expect(gate.evaluateGate(reportOf({forge: {name: "forge", severity: "high", via: [advisory("forge", "high", "GHSA-aaaa-bbbb-cccc")]}}), "high", REVIEWED, later).blocking)
            .toEqual(["forge GHSA-aaaa-bbbb-cccc (review expired 2027-01-31)"]);
    });

    it("resolves transitive entries to the advisories of the packages they point at", () => {
        const report = reportOf({
            forge: {name: "forge", severity: "high", via: [advisory("forge", "high", "GHSA-aaaa-bbbb-cccc")]},
            wrapper: {name: "wrapper", severity: "high", via: ["forge"]},
        });
        expect(gate.evaluateGate(report, "high", REVIEWED, NOW).blocking).toEqual([]);
        const bad = reportOf({lib: {name: "lib", severity: "high", via: [advisory("lib", "high", "GHSA-1111-2222-3333")]}, wrap: {name: "wrap", severity: "high", via: ["lib"]}});
        expect(gate.evaluateGate(bad, "high", REVIEWED, NOW).blocking).toEqual(["lib GHSA-1111-2222-3333"]);
    });

    it("blocks a HIGH entry whose advisories cannot be resolved", () => {
        expect(gate.evaluateGate(reportOf({wrap: {name: "wrap", severity: "high", via: ["missing"]}}), "high", REVIEWED, NOW).blocking)
            .toEqual(["wrap (unresolved via)"]);
    });

    it("ignores moderate and low advisories", () => {
        expect(gate.evaluateGate(reportOf({x: {name: "x", severity: "moderate", via: [advisory("x", "moderate", "GHSA-9999-8888-7777")]}}), "high", REVIEWED, NOW).blocking).toEqual([]);
    });

    // #293: moderate 검사(주간 감사·릴리스)도 같은 검토 예외를 쓴다. 그래야 수정 버전이 없는 권고로 릴리스가 막혔을 때
    // 정해진 절차(검토 → 예외 등록 → 180일 안 재검토)로 풀 수 있다. critical 은 여전히 예외로도 통과하지 않는다.
    it("the moderate gate accepts a reviewed moderate advisory and blocks an unreviewed one", () => {
        const reviewedModerate = reportOf({forge: {name: "forge", severity: "moderate", via: [advisory("forge", "moderate", "GHSA-aaaa-bbbb-cccc")]}});
        expect(gate.evaluateGate(reviewedModerate, "moderate", REVIEWED, NOW)).toEqual({blocking: [], accepted: ["forge GHSA-aaaa-bbbb-cccc"]});
        const unreviewed = reportOf({x: {name: "x", severity: "moderate", via: [advisory("x", "moderate", "GHSA-9999-8888-7777")]}});
        expect(gate.evaluateGate(unreviewed, "moderate", REVIEWED, NOW).blocking).toEqual(["x GHSA-9999-8888-7777"]);
    });

    it("the moderate gate ignores low, blocks any critical and expired reviews", () => {
        expect(gate.evaluateGate(reportOf({x: {name: "x", severity: "low", via: [advisory("x", "low", "GHSA-9999-8888-7777")]}}), "moderate", REVIEWED, NOW).blocking).toEqual([]);
        expect(gate.evaluateGate(reportOf({forge: {name: "forge", severity: "critical", via: [advisory("forge", "critical", "GHSA-aaaa-bbbb-cccc")]}}), "moderate", REVIEWED, NOW).blocking)
            .toEqual(["forge GHSA-aaaa-bbbb-cccc"]);
        expect(gate.evaluateGate(reportOf({forge: {name: "forge", severity: "moderate", via: [advisory("forge", "moderate", "GHSA-aaaa-bbbb-cccc")]}}), "moderate", REVIEWED,
            Date.parse("2027-02-01T00:00:00Z")).blocking).toEqual(["forge GHSA-aaaa-bbbb-cccc (review expired 2027-01-31)"]);
    });

    // 예외는 검토할 때의 등급까지만 덮는다. 권고 등급이 올라가면 다시 검토해야 한다.
    it("blocks a reviewed advisory whose severity rose above the reviewed severity", () => {
        const moderateReview = [{...REVIEWED[0], severity: "moderate"}];
        const regraded = reportOf({forge: {name: "forge", severity: "high", via: [advisory("forge", "high", "GHSA-aaaa-bbbb-cccc")]}});
        expect(gate.evaluateGate(regraded, "moderate", moderateReview, NOW).blocking).toEqual(["forge GHSA-aaaa-bbbb-cccc (reviewed as moderate, now high)"]);
        const same = reportOf({forge: {name: "forge", severity: "moderate", via: [advisory("forge", "moderate", "GHSA-aaaa-bbbb-cccc")]}});
        expect(gate.evaluateGate(same, "moderate", moderateReview, NOW).blocking).toEqual([]);
    });

    it("blocks a reviewed advisory whose exception does not record the reviewed severity", () => {
        const {severity: _omit, ...withoutSeverity} = REVIEWED[0];
        void _omit;
        const report = reportOf({forge: {name: "forge", severity: "moderate", via: [advisory("forge", "moderate", "GHSA-aaaa-bbbb-cccc")]}});
        expect(gate.evaluateGate(report, "moderate", [withoutSeverity], NOW).blocking).toEqual(["forge GHSA-aaaa-bbbb-cccc (reviewed severity missing)"]);
    });

    // 판정 진입점은 evaluateGate 하나다(#293).
    it("the gate has a single entry point and rejects unsupported levels", () => {
        const report = reportOf({x: {name: "x", severity: "moderate", via: [advisory("x", "moderate", "GHSA-9999-8888-7777")]}});
        expect(gate.evaluateHighGate).toBeUndefined();
        expect(() => gate.evaluateGate(report, "info", REVIEWED, NOW)).toThrow("Unsupported gate level: info");
    });

    // #293: 수정 버전이 나오면 예외를 지우고 업그레이드로 푼다. 그래서 목록은 비어 있을 수 있다.
    it("every reviewed advisory in the repository has an id, package, reviewed severity, reason and a review date within 180 days", () => {
        expect(Array.isArray(gate.REVIEWED_ADVISORIES)).toBe(true);
        for(const entry of gate.REVIEWED_ADVISORIES) {
            expect(entry.id).toMatch(/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);
            expect(typeof entry.package).toBe("string");
            // 서버 판정은 moderate 부터 본다. low 예외는 아무 권고도 덮지 못한다.
            expect(["moderate", "high"]).toContain(entry.severity);
            expect(entry.reason.length).toBeGreaterThan(20);
            const reviewedOn = Date.parse(entry.reviewedOn);
            const reviewBy = Date.parse(entry.reviewBy);
            expect(Number.isFinite(reviewedOn) && Number.isFinite(reviewBy)).toBe(true);
            // 예외는 길게 두지 않는다. 검토일에서 180일 안에 다시 본다.
            expect(reviewBy - reviewedOn).toBeGreaterThan(0);
            expect(reviewBy - reviewedOn).toBeLessThanOrEqual(180 * 86_400_000);
        }
    });
});

// #180 에서 예외의 전제로 둔 검사다. #293 으로 예외는 지웠지만, node-forge 를 쓰는 곳을 좁게 두고 서명·체인 검증은
// Node/OpenSSL 에 맡긴다는 원칙은 계속 지킨다.
describe("node-forge stays limited to certificate generation and PEM parsing (#180, #293)", () => {
    const sources = (dir: string): string[] => fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if(entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(full);
        return /\.(ts|svelte|js|cjs|mjs)$/.test(entry.name) ? [full] : [];
    });

    const all = () => [...sources(path.join(repoRoot, "src")), ...sources(path.join(repoRoot, "admin", "src"))];

    it("only the reviewed files import node-forge", () => {
        // 새 파일이 node-forge 를 쓰기 시작하면 예외의 전제를 다시 검토해야 한다.
        const users = all().filter((file) => /node-forge/.test(fs.readFileSync(file, "utf8")))
            .map((file) => path.relative(repoRoot, file).split(path.sep).join("/")).sort();
        expect(users).toEqual([
            "admin/src/screens/parts/InputCertFile.svelte",
            "src/commons/CACertGenerator.ts",
            "src/server/CertificationStore.ts",
        ]);
    });

    it("the reviewed files do not use node-forge signature or chain verification", () => {
        const offenders = all().filter((file) => /node-forge/.test(fs.readFileSync(file, "utf8")))
            .filter((file) => /\bverify\b|verifyCertificateChain|createCaStore|verifySignature|pkcs7|forge\.tls/.test(fs.readFileSync(file, "utf8")));
        expect(offenders).toEqual([]);
    });
});

describe("ip-address is patched (#180)", () => {
    it("the lockfile installs ip-address 10.7.1 or later everywhere", () => {
        const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
        const versions = Object.entries<any>(lock.packages ?? {}).filter(([key]) => key.endsWith("node_modules/ip-address")).map(([, meta]) => meta.version as string);
        expect(versions.length).toBeGreaterThan(0);
        for(const version of versions) {
            const [major, minor, patch] = version.split(".").map(Number);
            expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(10 * 1e6 + 7 * 1e3 + 1);
        }
    });
});
