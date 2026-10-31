/**
 * R3-REQ-03 — form-data 및 @babel/traverse CRITICAL 수정 검증.
 * NO-MOCK: 실 npm audit CLI (production 트리) 결과 확인.
 *
 * 근거:
 *   - form-data <4.0.4 : GHSA-fjxv-7rqg-78g4 (boundary 예측 가능)
 *   - @babel/traverse <7.23.2 : GHSA-67hx-6x53-jw92 (빌드 타임 RCE)
 *
 * 런타임(production) 트리에서 CRITICAL 0건이 요구사항.
 * @babel/traverse 는 빌드 타임(dev) 도구 체인에 있으므로 별도 P4 범위이나,
 * 여기서는 production audit 로 form-data 만 강제 검증한다.
 */
import {audit, onlineTest} from "../helpers/SupplyChainGate";
import * as path from "path";

const repoRoot = path.resolve(__dirname, "..", "..");
const {evaluateGate} = require("../../scripts/supply-chain-gate.cjs");
/** form-data 에 검토 예외 밖의 moderate 이상 권고가 남았는지(#293 REQ-4a). */
const formDataBlocking = (report: unknown, reviewed?: unknown[], now?: number): string[] =>
    evaluateGate(report, "moderate", reviewed, now).blocking.filter((label: string) => label.startsWith("form-data "));

describe("R3-REQ-03 CRITICAL cleared on production chain", () => {
    onlineTest("npm audit --omit=dev --audit-level=critical → 0건", () => {
        const vulnerabilities = audit("critical").vulnerabilities;
        const criticalHits: string[] = [];
        for(const [name, data] of Object.entries<any>(vulnerabilities)) {
            if(data?.severity === "critical") criticalHits.push(name);
        }
        expect(criticalHits).toEqual([]);
    }, 60_000);

    onlineTest("npm audit --omit=dev → form-data 는 검토 예외 밖 moderate 이상 0건, 그 밖의 HIGH 는 검토 예외만(#180, #293)", () => {
        const report = audit("high");
        expect(formDataBlocking(report)).toEqual([]);
        expect(evaluateGate(report, "high").blocking).toEqual([]);
    }, 60_000);

    // #293 REQ-4a: form-data 도 다른 의존성처럼 검토 예외를 따른다. low 하나나 검토한 권고로 릴리스가 막히지 않는다.
    test("form-data check follows reviewed exceptions and ignores low", () => {
        const advisory = (severity: string, ghsa: string) =>
            ({source: 1, name: "form-data", dependency: "form-data", title: "form-data advisory", url: `https://github.com/advisories/${ghsa}`, severity, range: "*"});
        const reportOf = (severity: string) => ({auditReportVersion: 2,
            vulnerabilities: {"form-data": {name: "form-data", severity, via: [advisory(severity, "GHSA-1111-2222-3333")]}}});
        const reviewed = [{id: "GHSA-1111-2222-3333", package: "form-data", severity: "moderate", reviewedOn: "2026-10-31", reviewBy: "2027-04-01", reason: "unused API"}];
        const now = Date.parse("2026-11-01T00:00:00Z");
        expect(formDataBlocking(reportOf("low"), [], now)).toEqual([]);
        expect(formDataBlocking(reportOf("moderate"), reviewed, now)).toEqual([]);
        expect(formDataBlocking(reportOf("moderate"), [], now)).toEqual(["form-data GHSA-1111-2222-3333"]);
    });

    test("form-data overrides 설정 존재 (production 트리 트랜지티브 고정)", () => {
        const fs = require("fs");
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
        expect(pkg.overrides).toBeDefined();
        expect(pkg.overrides["form-data"]).toBeDefined();
    });
});
