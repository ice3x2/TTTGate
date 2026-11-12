import type {TunnelingStatus} from "../../admin/src/controller/Options";
import {addedConnections, announcement, blockBodyText, blockedDoneText, clientsView, connectionsSupported, mergeConnections, MAX_KEPT_ENDED,
    statsView, summaryCount, type ConnectionRow} from "../../admin/src/screens/parts/connections";
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
    test("잘린 응답(truncated)에서 받은 목록의 가장 오래된 연결보다 오래된 줄은 살아 있을 수 있어 끝남으로 바꾸지 않고 숨긴다", () => {
        // 서버는 (connectedAt, id) 가 큰 것부터 준다. row(n) 은 n 이 클수록 오래되었다. 받은 목록의 가장 오래된 연결은 row(2) 다.
        const next = mergeConnections([row(1), row(2), row(3)], [row(0), row(2)], {truncated: true});
        expect(next.map((r) => [r.id, r.state])).toEqual([[1, "ended"], [2, "live"], [0, "live"]]);
        // 잘리지 않은 응답이면 지금처럼 끝남이다.
        expect(mergeConnections([row(1), row(2)], [row(2)], {truncated: false}).map((r) => r.state)).toEqual(["ended", "live"]);
    });
    test("M-1 잘린 응답이 이어져도 살아 있는 줄은 서버가 준 수를 넘지 않는다", () => {
        // 500개 상한을 3개로 줄여 본다. 새 연결이 들어올 때마다 가장 오래된 연결이 목록 밖으로 밀려난다.
        let rows = mergeConnections([], [row(3), row(4), row(5)], {truncated: true, first: true});
        for(const newest of [2, 1, 0]) {
            rows = mergeConnections(rows, [row(newest), row(newest + 1), row(newest + 2)], {truncated: true});
            expect(rows.filter((r) => r.state === "live").map((r) => r.id).sort()).toEqual([newest, newest + 1, newest + 2]);
        }
        // 연결 시각이 같으면 id 가 큰 쪽이 더 최근이다(서버 정렬과 같다).
        const same = (id: number) => row(id, {connectedAt: NOW});
        const tied = mergeConnections([same(5), same(4), same(3)], [same(5), same(4)], {truncated: true});
        expect(tied.map((r) => [r.id, r.state])).toEqual([[5, "live"], [4, "live"]]);
        const gone = mergeConnections([same(5), same(4), same(3)], [same(5), same(3)], {truncated: true});
        expect(gone.map((r) => [r.id, r.state])).toEqual([[5, "live"], [4, "ended"], [3, "live"]]);
    });
    test("M-1 요약 연결 수는 서버가 준 전체 수이고, 옛 서버(전체 수 없음)는 살아 있는 줄 수다", () => {
        const rows = [row(1), row(2, {state: "ended"}), row(3)];
        expect(summaryCount(rows, 812)).toBe(812);
        expect(summaryCount(rows, undefined)).toBe(2);
    });
    test("M-2 빈 목록으로 연 창에 새 연결이 들어오면 '새'로 붙고 새로 붙은 수로 센다", () => {
        const first = mergeConnections([], [], {first: true});
        expect(first).toEqual([]);
        const next = mergeConnections(first, [row(1)], {first: false});
        expect(next.map((r) => [r.id, r.state, r.isNew])).toEqual([[1, "live", true]]);
        expect(addedConnections(first, next)).toBe(1);
        // 처음 읽기는 연결이 있어도 새 표시가 없고 알리지 않는다.
        const opened = mergeConnections([], [row(1), row(2)], {first: true});
        expect(opened.map((r) => r.isNew)).toEqual([false, false]);
        expect(addedConnections([], opened)).toBe(0);
    });
    test("끝난 줄은 상한까지만 남기고, 넘으면 오래된 끝난 줄부터 버린다. 살아 있는 줄은 버리지 않는다", () => {
        const prev = [row(0), ...Array.from({length: MAX_KEPT_ENDED}, (_, i) => row(i + 1, {state: "ended"}))];
        const next = mergeConnections(prev, [row(0)]);
        expect(next).toHaveLength(MAX_KEPT_ENDED + 1);
        expect(next[0]).toMatchObject({id: 0, state: "live"});
        expect(next.filter((r) => r.state !== "live")).toHaveLength(MAX_KEPT_ENDED);
        // 0 이 끝나 끝난 줄이 상한을 넘으면 가장 위(오래된) 끝난 줄인 0 이 빠진다.
        const after = mergeConnections(next, []);
        expect(after).toHaveLength(MAX_KEPT_ENDED);
        expect(after[0].id).toBe(1);
    });
    test("addedConnections 는 이번에 새로 붙은 줄 수다(처음 읽기는 0)", () => {
        const first = mergeConnections([], [row(1)]);
        expect(addedConnections([], first)).toBe(0);
        const second = mergeConnections(first, [row(1), row(2), row(3)]);
        expect(addedConnections(first, second)).toBe(2);
        expect(addedConnections(second, mergeConnections(second, [row(1), row(2), row(3)]))).toBe(0);
    });
});

describe("L-2 낭독 알림", () => {
    test("같은 문장이 연달아 나와도 글자가 바뀌어 다시 읽힌다", () => {
        const first = announcement("", "1 new connection");
        expect(first).toBe("1 new connection");
        const second = announcement(first, "1 new connection");
        expect(second).not.toBe(first);
        expect(second.replace(/\u200B/g, "")).toBe("1 new connection");
        expect(announcement(second, "1 new connection")).toBe(first);
        expect(announcement(second, "2 new connections")).toBe("2 new connections");
    });
});

describe("M-3 옛 서버 판단", () => {
    test("상태 응답에 allowedClients 가 있으면 새 서버라 연결 목록을 볼 수 있고, 없으면 옛 서버다", () => {
        expect(connectionsSupported(status({allowedClients: []}))).toBe(true);
        expect(connectionsSupported(status())).toBe(false);
        expect(connectionsSupported(undefined)).toBe(false);
    });
    test("새 서버가 404 를 주면 이 터널을 더 볼 수 없다고 알린다", () => {
        expect(en.t("connections.notVisible")).toBe("You can no longer see the connections to this tunnel.");
        expect(ko.t("connections.notVisible")).toBe("이 터널의 연결을 더 볼 수 없습니다.");
    });
});

describe("차단 확인 문장과 차단 뒤 알림 (L5·설계 문구)", () => {
    test("이 터널만: 연결 수가 있으면 그 수를, 없으면 앞으로 받지 않는다는 것만 말한다", () => {
        expect(blockBodyText({count: 2, scope: "tunnel"}, ko)).toBe("이 주소의 연결 2개를 바로 끊고, 앞으로 들어오는 연결도 받지 않습니다.");
        expect(blockBodyText({count: 1, scope: "tunnel"}, en)).toBe("Its 1 connection ends now, and new ones will be refused.");
        expect(blockBodyText({count: 0, scope: "tunnel"}, ko)).toBe("앞으로 이 주소에서 이 터널로 들어오는 연결을 받지 않습니다.");
        expect(blockBodyText({count: 0, scope: "tunnel"}, en)).toBe("New connections from this address to this tunnel will be refused.");
    });
    test("모든 터널: 다른 터널의 연결도 끊긴다는 것을 말한다", () => {
        expect(blockBodyText({count: 2, scope: "all"}, ko)).toBe("이 터널에 있는 이 주소의 연결 2개와 다른 터널에 있는 이 주소의 연결을 바로 끊고, 앞으로 모든 터널에서 이 주소의 연결을 받지 않습니다.");
        expect(blockBodyText({count: 2, scope: "all"}, en)).toBe("Its 2 connections to this tunnel and its connections to other tunnels end now, and new ones to every tunnel will be refused.");
        expect(blockBodyText({count: 1, scope: "all"}, ko)).toBe("이 터널에 있는 이 주소의 연결 1개와 다른 터널에 있는 이 주소의 연결을 바로 끊고, 앞으로 모든 터널에서 이 주소의 연결을 받지 않습니다.");
        expect(blockBodyText({count: 1, scope: "all"}, en)).toBe("Its 1 connection to this tunnel and its connections to other tunnels end now, and new ones to every tunnel will be refused.");
        expect(blockBodyText({count: 0, scope: "all"}, ko)).toBe("다른 터널에 있는 이 주소의 연결을 바로 끊고, 앞으로 모든 터널에서 이 주소의 연결을 받지 않습니다.");
        expect(blockBodyText({count: 0, scope: "all"}, en)).toBe("Any connections from this address to other tunnels end now, and new ones to every tunnel will be refused.");
    });
    test("차단 뒤 알림은 끊은 연결이 없으면 수를 말하지 않는다", () => {
        expect(blockedDoneText("203.0.113.7", 2, ko)).toBe("203.0.113.7 주소를 차단하고 연결 2개를 끊었습니다.");
        expect(blockedDoneText("203.0.113.7", 0, ko)).toBe("203.0.113.7 주소를 차단했습니다.");
        expect(blockedDoneText("203.0.113.7", 0, en)).toBe("Blocked 203.0.113.7.");
    });
});

describe("연결 창 문구 (설계 문서 문구 표)", () => {
    test("맨 위 요약, 새 연결 알림, 500개 안내, 옛 서버 안내", () => {
        expect(ko.plural("connections.summary", 3)).toBe("연결 3개 · 2초마다 새로 고침");
        expect(en.plural("connections.summary", 3)).toBe("3 connections · Refreshes every 2 seconds");
        expect(en.plural("connections.summary", 1)).toBe("1 connection · Refreshes every 2 seconds");
        expect(ko.plural("connections.newAnnounce", 1)).toBe("새 연결 1개");
        expect(en.plural("connections.newAnnounce", 2)).toBe("2 new connections");
        expect(ko.t("connections.capped")).toBe("최근 연결 500개만 보입니다.");
        expect(en.t("connections.capped")).toBe("Showing the latest 500.");
    });
    test("설계 문구를 따른다: 연결 시각, 외 N, 내 IP 경고", () => {
        expect(en.t("connections.connectedAgo", {ago: "3m ago"})).toBe("Connected 3m ago");
        expect(ko.t("tunnel.clientsMore", {count: 1})).toBe("외 1");
        expect(en.t("connections.selfWarning")).toBe("This is the address you're using now. Tunnels won't be reachable from it; the admin screen is not affected.");
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
