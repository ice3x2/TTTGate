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

    onlineTest("대상 패키지별 advisory 부재 (yaml/lodash/qs/nanoid/js-yaml/diff/formidable)", () => {
        const parsed = audit("low");
        const vulns = parsed.vulnerabilities;
        const targets = ["yaml", "lodash", "qs", "nanoid", "js-yaml", "diff", "formidable"];
        const hits = targets.filter((name) => vulns[name] !== undefined);
        expect(hits).toEqual([]);
    }, 60_000);
});
