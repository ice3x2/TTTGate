/**
 * R3-REQ-04 — 런타임(production) MEDIUM advisory 정리 검증.
 * NO-MOCK: 실 npm audit CLI.
 *
 * 범위:
 *   - 서버 런타임: npm audit --omit=dev --audit-level=moderate 0건
 *   - yaml / lodash / qs / nanoid / js-yaml / diff / formidable 개별 advisory 부재
 */
import {audit, onlineTest} from "../helpers/SupplyChainGate";

describe("R3-REQ-04 runtime MEDIUM advisories cleared", () => {
    onlineTest("npm audit --omit=dev --audit-level=moderate → 총 0건", () => {
        const parsed = audit("moderate");
        const vulns = parsed.vulnerabilities;
        const hits = Object.keys(vulns);
        expect(hits).toEqual([]);
    }, 60_000);

    onlineTest("대상 패키지별 advisory 부재 (yaml/lodash/qs/nanoid/js-yaml/diff/formidable)", () => {
        const parsed = audit("low");
        const vulns = parsed.vulnerabilities;
        const targets = ["yaml", "lodash", "qs", "nanoid", "js-yaml", "diff", "formidable"];
        const hits = targets.filter((name) => vulns[name] !== undefined);
        expect(hits).toEqual([]);
    }, 60_000);
});
