/**
 * R3-REQ-04 — 런타임(production) MEDIUM advisory 정리 검증.
 * NO-MOCK: 실 npm audit CLI.
 *
 * 범위:
 *   - 서버 런타임: npm audit --omit=dev --audit-level=moderate 에서 검토 예외 밖의 권고 0건(#293)
 *   - yaml / lodash / qs / nanoid / js-yaml / diff / formidable 개별 advisory 부재
 */
import {audit, onlineTest} from "../helpers/SupplyChainGate";

const {evaluateGate} = require("../../scripts/supply-chain-gate.cjs");

describe("R3-REQ-04 runtime MEDIUM advisories cleared", () => {
    // #293: 수정 버전이 없는 권고는 검토 예외(REVIEWED_ADVISORIES, 180일 안 재검토)로만 통과한다. critical 은 통과하지 않는다.
    onlineTest("npm audit --omit=dev --audit-level=moderate → 검토 예외 밖의 권고 0건", () => {
        expect(evaluateGate(audit("moderate"), "moderate").blocking).toEqual([]);
    }, 60_000);

    // #293: 지난 정리(R3)에서 고친 패키지에 moderate 이상 권고가 다시 생기지 않았는지 본다. 첫 검사와 같은 기준(검토 예외 포함)을 쓴다.
    onlineTest("대상 패키지별 advisory 부재 (yaml/lodash/qs/nanoid/js-yaml/diff/formidable)", () => {
        expect(targetBlocking(evaluateGate(audit("moderate"), "moderate").blocking)).toEqual([]);
    }, 60_000);
});

// 대상 패키지 이름으로 시작하는 차단 항목만 고른다(예: "lodash GHSA-…").
const TARGETS = ["yaml", "lodash", "qs", "nanoid", "js-yaml", "diff", "formidable"];
const targetBlocking = (blocking: string[]): string[] => blocking.filter((label) => TARGETS.includes(label.split(" ")[0]));

describe("R3-REQ-04 target package check follows reviewed exceptions (#293)", () => {
    const advisory = (name: string, severity: string, ghsa: string) =>
        ({source: 1, name, dependency: name, title: `${name} advisory`, url: `https://github.com/advisories/${ghsa}`, severity, range: "*"});
    const report = {auditReportVersion: 2, vulnerabilities: {lodash: {name: "lodash", severity: "moderate", via: [advisory("lodash", "moderate", "GHSA-1111-2222-3333")]}}};
    const now = Date.parse("2026-11-01T00:00:00Z");

    test("a reviewed lodash advisory passes, an unreviewed one blocks", () => {
        const reviewed = [{id: "GHSA-1111-2222-3333", package: "lodash", severity: "moderate", reviewedOn: "2026-10-31", reviewBy: "2027-04-01", reason: "unused API"}];
        expect(targetBlocking(evaluateGate(report, "moderate", reviewed, now).blocking)).toEqual([]);
        expect(targetBlocking(evaluateGate(report, "moderate", [], now).blocking)).toEqual(["lodash GHSA-1111-2222-3333"]);
    });
});
