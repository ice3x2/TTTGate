import type {TunnelingStatus} from "../../admin/src/controller/Options";
import {addedConnections, announcement, blockBodyText, blockedDoneText, blockFailureText, clientsView, closingFailure, closingFailureText, connectionsSupported, duplicateBlockText,
    duplicateCoversTunnel,
    mergeConnections, MAX_KEPT_ENDED, statsView, summaryCount, type ConnectionRow, type FetchedConnection} from "../../admin/src/screens/parts/connections";
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
    test("M-A 잘린 목록에서 숨겼던 오래된 연결이 다시 보이면 새 연결이 아니다(창이 열린 동안 본 id 를 기억한다)", () => {
        // 연결 501개(id 2..502) 중 서버는 최근 500개(502..3)만 준다. 연결 시각은 id 가 클수록 최근이다.
        const fetched = (id: number): FetchedConnection => ({id, remoteAddress: "10.0.0.1", remotePort: 1, connectedAt: id * 10, rx: 0, tx: 0});
        const range = (from: number, to: number) => Array.from({length: from - to + 1}, (_, i) => fetched(from - i));
        const seen = new Set<number>();
        const read = (prev: ConnectionRow[], list: FetchedConnection[], first: boolean) => {
            const next = mergeConnections(prev, list, {truncated: true, first, seen});
            for(const connection of list) seen.add(connection.id);
            return next;
        };
        // 처음 읽기는 501..2 다(id 2 가 가장 오래되었다).
        const opened = read([], range(501, 2), true);
        // id 600 이 들어와 id 2 가 목록 밖으로 밀려나 숨는다.
        const pushed = read(opened, [fetched(600), ...range(501, 3)], false);
        expect(pushed.some((r) => r.id === 2)).toBe(false);
        expect(addedConnections(opened, pushed)).toBe(1);
        // id 600 이 끝나 id 2 가 다시 목록에 들어온다. 처음부터 있던 연결이므로 "새"가 아니고 알리지도 않는다.
        const back = read(pushed, range(501, 2), false);
        expect(back.find((r) => r.id === 2)).toMatchObject({state: "live", isNew: false});
        expect(back.find((r) => r.id === 600)?.state).toBe("ended");
        expect(addedConnections(pushed, back)).toBe(0);
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

describe("M-B 연결 목록 읽기 실패", () => {
    test("404 는 더 볼 수 없다고, 403(볼 수만 있음)은 볼 수만 있게 되었다고 알리며 창을 닫는다", () => {
        expect(closingFailureText(404, ko)).toBe("이 터널의 연결을 더 볼 수 없습니다.");
        expect(closingFailureText(403, ko)).toBe("이제 이 터널을 볼 수만 있어 연결 목록을 닫았습니다.");
        expect(closingFailureText(403, en)).toBe("You can now only view this tunnel, so its connection list was closed.");
    });
    test("그 밖의 실패(네트워크 0, 500 등)는 창을 닫지 않는다. 이미 읽은 뒤면 새로 고치지 못했다고 안내한다", () => {
        expect(closingFailureText(0, en)).toBeUndefined();
        expect(closingFailureText(500, en)).toBeUndefined();
        expect(ko.t("connections.refreshFailed")).toBe("연결 목록을 새로 고치지 못했습니다. 다시 시도하는 중입니다.");
        expect(en.t("connections.refreshFailed")).toBe("Unable to refresh the connection list. Trying again.");
    });
    test("LOW-4: 403 mfa_enrollment_required 는 등록 화면으로 옮겨 가므로 알림 없이 창만 닫는다", () => {
        expect(closingFailure({status: 403, code: "mfa_enrollment_required"}, ko)).toEqual({notice: undefined});
        expect(closingFailure({status: 403, code: "forbidden"}, ko)).toEqual({notice: "이제 이 터널을 볼 수만 있어 연결 목록을 닫았습니다."});
        expect(closingFailure({status: 403}, en)).toEqual({notice: "You can now only view this tunnel, so its connection list was closed."});
        expect(closingFailure({status: 404, code: "not_found"}, ko)).toEqual({notice: "이 터널의 연결을 더 볼 수 없습니다."});
        expect(closingFailure({status: 500}, en)).toBeUndefined();
        expect(closingFailure({status: 0}, en)).toBeUndefined();
    });
});

describe("L-2 이미 차단된 주소(409 duplicate)", () => {
    test("이미 있는 차단이 모든 터널(port null)이나 이 터널에 걸리면 이 터널의 줄도 차단된 것이다", () => {
        expect(duplicateCoversTunnel({code: "duplicate", port: null}, 2222)).toBe(true);
        expect(duplicateCoversTunnel({code: "duplicate", port: 2222}, 2222)).toBe(true);
        expect(duplicateCoversTunnel({code: "duplicate", port: 3333}, 2222)).toBe(false);
        // 포트를 주지 않는 응답은 알 수 없으므로 바꾸지 않는다.
        expect(duplicateCoversTunnel({code: "duplicate"}, 2222)).toBe(false);
    });
    test("M-1: 이미 있는 차단이 요청한 범위를 덮으면 이미 차단된 주소라고 알린다", () => {
        expect(duplicateBlockText({code: "duplicate", port: null}, {port: 2222, scope: "tunnel"}, ko)).toBe("이미 차단된 주소입니다.");
        expect(duplicateBlockText({code: "duplicate", port: null}, {port: 2222, scope: "all"}, en)).toBe("This address is already blocked.");
        expect(duplicateBlockText({code: "duplicate", port: 2222}, {port: 2222, scope: "tunnel"}, ko)).toBe("이미 차단된 주소입니다.");
        // 포트를 주지 않는 응답은 범위를 알 수 없으므로 지금 문구를 쓴다.
        expect(duplicateBlockText({code: "duplicate"}, {port: 2222, scope: "tunnel"}, en)).toBe("This address is already blocked.");
    });
    test("M-1: 이미 있는 차단이 다른 포트 하나에만 걸리거나 '모든 터널' 요청을 덮지 못하면 그 범위를 밝힌다", () => {
        expect(duplicateBlockText({code: "duplicate", port: 3333}, {port: 2222, scope: "tunnel"}, ko))
            .toBe("이 주소는 이미 포트 3333에만 차단되어 있습니다. 범위를 바꾸려면 보안 화면의 '차단한 주소'에서 차단을 해제한 뒤 다시 차단하세요.");
        expect(duplicateBlockText({code: "duplicate", port: 3333}, {port: 2222, scope: "all"}, en))
            .toBe("This address is already blocked on port 3333 only. To change that, unblock it under Blocked addresses on the Security screen, then block it again.");
        expect(duplicateBlockText({code: "duplicate", port: 2222}, {port: 2222, scope: "all"}, ko))
            .toBe("이 주소는 이미 포트 2222에만 차단되어 있습니다. 범위를 바꾸려면 보안 화면의 '차단한 주소'에서 차단을 해제한 뒤 다시 차단하세요.");
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
        // LOW-1: 다른 터널에 이 주소의 연결이 없을 수도 있으므로 "있으면" 끊는다고 말한다.
        expect(blockBodyText({count: 2, scope: "all"}, ko)).toBe("이 터널에 있는 이 주소의 연결 2개를 바로 끊고, 다른 터널에 이 주소의 연결이 있으면 그것도 끊습니다. 앞으로 모든 터널에서 이 주소의 연결을 받지 않습니다.");
        expect(blockBodyText({count: 2, scope: "all"}, en)).toBe("Its 2 connections to this tunnel end now, as do its connections to other tunnels, if any, and new ones to every tunnel will be refused.");
        expect(blockBodyText({count: 1, scope: "all"}, ko)).toBe("이 터널에 있는 이 주소의 연결 1개를 바로 끊고, 다른 터널에 이 주소의 연결이 있으면 그것도 끊습니다. 앞으로 모든 터널에서 이 주소의 연결을 받지 않습니다.");
        expect(blockBodyText({count: 1, scope: "all"}, en)).toBe("Its 1 connection to this tunnel ends now, as do its connections to other tunnels, if any, and new ones to every tunnel will be refused.");
        // L-4: 다른 터널에 연결이 없을 수도 있으므로 "있으면" 끊는다고 말한다.
        expect(blockBodyText({count: 0, scope: "all"}, ko)).toBe("다른 터널에 이 주소의 연결이 있으면 바로 끊고, 앞으로 모든 터널에서 이 주소의 연결을 받지 않습니다.");
        expect(blockBodyText({count: 0, scope: "all"}, en)).toBe("Connections from this address to other tunnels, if any, end now, and new ones to every tunnel will be refused.");
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

describe("blockFailureText (설계 예외 표: 차단 목록이 가득 참)", () => {
    test("가득 찼으면(code full) 보안 화면과 같은 안내 문구를 쓴다", () => {
        expect(blockFailureText({code: "full", max: 1000}, en)).toBe("The blocklist is full. Unblock an address to add another.");
        expect(blockFailureText({code: "full", max: 1000}, ko)).toBe("차단 목록이 가득 찼습니다. 주소를 더하려면 다른 주소의 차단을 푸세요.");
    });
    test("그 밖의 실패는 서버 오류 문구를 그대로 쓴다", () => {
        expect(blockFailureText({code: "unknown_code", message: "server said no"}, en)).toBe("server said no");
    });
});
