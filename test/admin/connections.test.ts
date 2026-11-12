import type {TunnelingStatus} from "../../admin/src/controller/Options";
import {clientsView, mergeConnections, statsView, type ConnectionRow} from "../../admin/src/screens/parts/connections";
import {isTopModal, closeModal, openModal} from "../../admin/src/ui/modalStack";
import {translator} from "../../admin/src/i18n";

// 이슈 369 — 목록 줄의 가동 정보·허용 클라이언트, 연결 창의 줄 순서(순수 함수)와 겹친 창의 Esc 순서.
const en = translator("en");
const ko = translator("ko");
const NOW = 1_800_000_000_000;
const status = (overrides: Partial<TunnelingStatus> = {}): TunnelingStatus => ({
    port: 2222, online: true, sessions: 2, uptime: NOW - 3 * 86_400_000, active: true, activeStart: NOW - 7_500_000, activeTimeout: 0,
    rx: 59_535, tx: 60_900, ...overrides
} as TunnelingStatus);

describe("statsView (FR-1·FR-7·AC-2·AC-14)", () => {
    test("켜진 시각이 있으면 '켜진 지'로, 크기는 바이트 단위 기호(KiB)로 적는다", () => {
        const view = statsView(status({activatedAt: NOW - 7_500_000}), NOW, ko)!;
        expect(view).toEqual({sessions: 2, line: "켜진 지 2시간 5분 · RX 58.1KiB · TX 59.5KiB"});
        expect(statsView(status({activatedAt: NOW - 30_000}), NOW, en)!.line).toBe("On for 30s · RX 58.1KiB · TX 59.5KiB");
    });
    test("옛 서버(activatedAt 없음)는 지금의 가동 시간을 쓴다", () => {
        expect(statsView(status(), NOW, en)!.line).toBe("Uptime 3d, 0h · RX 58.1KiB · TX 59.5KiB");
    });
    test("꺼졌거나 열리지 않은 터널은 가동 정보가 없다", () => {
        expect(statsView(status({active: false}), NOW, en)).toBeUndefined();
        expect(statsView(status({online: false}), NOW, en)).toBeUndefined();
        expect(statsView(undefined, NOW, en)).toBeUndefined();
    });
});

describe("clientsView (FR-3·AC-3)", () => {
    test("이름과 연결 여부를 보이고, 셋 이상이면 앞의 둘과 '외 N' 이며 전체는 title 이다", () => {
        const one = clientsView({allowedClients: [{clientId: "c1", name: "사무실 PC", connected: false}]}, ko)!;
        expect(one).toEqual({label: "클라이언트", items: [{name: "사무실 PC", connected: false}], more: undefined, title: "사무실 PC (연결 안 됨)"});
        const many = clientsView({allowedClients: ["a", "b", "c"].map((name, i) => ({clientId: name, name, connected: i === 0}))}, en)!;
        expect(many.items.map((item) => item.name)).toEqual(["a", "b"]);
        expect(many.more).toBe("+1 more");
        expect(many.title).toBe("a, b (not connected), c (not connected)");
    });
    test("고른 클라이언트가 없으면 '모두', 옛 이름 규칙만 있으면 규칙을 보인다", () => {
        expect(clientsView({allowedClients: [], allowedClientNames: []}, ko)!.items).toEqual([{name: "모두", connected: undefined}]);
        expect(clientsView({allowedClients: [], allowedClientNames: ["edge-*"]}, en)!.items).toEqual([{name: "name rule edge-*", connected: undefined}]);
    });
    test("옛 서버(allowedClients 없음)는 보이지 않는다", () => {
        expect(clientsView({}, en)).toBeUndefined();
    });
});

describe("mergeConnections (설계 반영: 창이 열린 동안 줄 순서 고정)", () => {
    const row = (id: number, extra: Partial<ConnectionRow> = {}): ConnectionRow => ({id, remoteAddress: `10.0.0.${id}`, remotePort: 1000 + id,
        connectedAt: NOW - id * 1000, rx: 0, tx: 0, state: "live", isNew: false, ...extra});
    test("처음 읽으면 서버 순서 그대로이고 새 표시는 없다", () => {
        expect(mergeConnections([], [row(1), row(2)]).map((r) => [r.id, r.state, r.isNew])).toEqual([[1, "live", false], [2, "live", false]]);
    });
    test("다시 읽으면 기존 줄은 자리를 지키고, 새 연결은 맨 아래 '새', 사라진 연결은 '끝남'으로 남으며 값은 새로 고친다", () => {
        const prev = [row(1), row(2), row(3)];
        const next = mergeConnections(prev, [row(4), {...row(2), rx: 99}, row(1)]);
        expect(next.map((r) => [r.id, r.state, r.isNew])).toEqual([[1, "live", false], [2, "live", false], [3, "ended", false], [4, "live", true]]);
        expect(next[1].rx).toBe(99);
    });
    test("끊음·차단됨으로 표시한 줄은 그 표시를 지킨다", () => {
        const next = mergeConnections([row(1, {state: "closed"}), row(2, {state: "blocked"})], []);
        expect(next.map((r) => r.state)).toEqual(["closed", "blocked"]);
    });
});

describe("modalStack (설계 반영: 겹친 창의 Esc)", () => {
    test("맨 위 창만 Esc 를 받고, 닫으면 그 아래 창이 맨 위가 된다", () => {
        const lower = openModal();
        const upper = openModal();
        expect(isTopModal(upper)).toBe(true);
        expect(isTopModal(lower)).toBe(false);
        closeModal(upper);
        expect(isTopModal(lower)).toBe(true);
        closeModal(lower);
        expect(isTopModal(lower)).toBe(false);
    });
});
