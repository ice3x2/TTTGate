/**
 * R3-REQ-04 — 런타임(production) MEDIUM advisory 정리 검증.
 * NO-MOCK: 실 npm audit CLI.
 *
 * 범위: 서버 런타임 npm audit --omit=dev --audit-level=moderate 에서 검토 예외 밖의 moderate 이상 권고 0건(#293 REQ-4a).
 * 지난 정리(R3)에서 고친 yaml·lodash·qs·nanoid·js-yaml·diff·formidable 도 이 검사가 함께 본다(따로 audit 을 부르지 않는다).
 */
import {audit, onlineTest} from "../helpers/SupplyChainGate";

const {evaluateGate} = require("../../scripts/supply-chain-gate.cjs");

describe("R3-REQ-04 runtime MEDIUM advisories cleared", () => {
    // #293: 수정 버전이 없는 권고는 검토 예외(REVIEWED_ADVISORIES, 180일 안 재검토)로만 통과한다. critical 은 통과하지 않는다.
    onlineTest("npm audit --omit=dev --audit-level=moderate → 검토 예외 밖의 권고 0건", () => {
        expect(evaluateGate(audit("moderate"), "moderate").blocking).toEqual([]);
    }, 60_000);
});
