import {DEFAULT_GROUP_ATTRIBUTES, type GroupAttributes} from "../../admin/src/controller/Types";
import {summarizeAttributes} from "../../admin/src/screens/parts/groupSummary";
import {translator} from "../../admin/src/i18n";
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

// 이슈 349 FR-8 — 요약의 낱말도 정한 언어로 만든다. 코드 값(crud=full, 프로토콜 이름)은 옮기지 않는다.
describe("이슈 349 한국어 요약", () => {
    test("범위와 프로토콜이 있을 때와 없을 때", () => {
        expect(summarizeAttributes(FIELD_TEAM, translator("ko"))).toBe("crud=full · 터널 최대 2개 · 포트 20000-20099 · TCP,HTTP,HTTP_REWRITE");
        expect(summarizeAttributes(DEFAULT_GROUP_ATTRIBUTES, translator("ko"))).toBe("crud=full · 터널 최대 10개 · 포트 없음 · 프로토콜 없음");
    });
});
