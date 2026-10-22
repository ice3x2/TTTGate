import {DEFAULT_GROUP_ATTRIBUTES, type GroupAttributes} from "../../admin/src/controller/Types";
import {summarizeAttributes} from "../../admin/src/screens/parts/groupSummary";
import {RBAC_IDENTITY_FIXTURE} from "../helpers/rbacFixture";

// U3-04 / #106 — 그룹 카드의 속성 요약(순수 함수).
const FIELD_TEAM = RBAC_IDENTITY_FIXTURE.groups![0].attributes as GroupAttributes;

describe("summarizeAttributes", () => {
    test("Field team 속성을 요약한다", () => {
        expect(summarizeAttributes(FIELD_TEAM)).toBe("crud=full · tunnels≤2 · ports 20000-20099 · TCP,HTTP,HTTP_REWRITE");
    });

    test("기본값이면 범위·프로토콜이 none 이다", () => {
        expect(summarizeAttributes(DEFAULT_GROUP_ATTRIBUTES)).toBe("crud=full · tunnels≤10 · ports none · none");
    });

    test("범위가 둘이면 쉼표로 잇고, 프로토콜은 서버 순서와 무관하게 고정 순서다", () => {
        const summary = summarizeAttributes({...DEFAULT_GROUP_ATTRIBUTES,
            allowed_port_range: [{from: 20000, to: 20099}, {from: 30000, to: 30010}],
            allowed_protocols: ["HTTP_REWRITE", "HTTPS", "TCP"]});
        expect(summary).toContain("ports 20000-20099, 30000-30010");
        expect(summary.endsWith(" · TCP,HTTPS,HTTP_REWRITE")).toBe(true);
    });
});
