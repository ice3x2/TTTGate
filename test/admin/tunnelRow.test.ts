import type {Options, TunnelingStatus} from "../../admin/src/controller/Options";
import {clockOf, formatEnds, formatRemaining, tunnelRowView, tunnelTitle, undoTimeoutOf} from "../../admin/src/screens/parts/tunnelRow";
import {translator} from "../../admin/src/i18n";

// #338 REQ-5·REQ-8·REQ-15 — 터널 목록 한 줄의 제목·상태 줄·스위치(순수 함수).

// #344: 종료 시각은 실행 환경의 시간대로 보인다. 기준 시각을 그 시간대의 2027-01-15 17:00 으로 만들어 어느 시간대에서도 같은 결과를 얻는다.
const NOW = new Date(2027, 0, 15, 17, 0, 0).getTime();
const ME = "u_me";

const option = (overrides: Partial<Options> = {}): Options => ({
    forwardPort: 2222, protocol: "tcp", destinationAddress: "10.0.0.5", destinationPort: 22, owner: {id: ME, username: "me"},
    ...overrides
} as Options);

const status = (overrides: Partial<TunnelingStatus> & {clientConnected?: boolean} = {}): TunnelingStatus => ({
    port: 2222, online: true, sessions: 0, uptime: NOW - 60_000, active: true, activeStart: NOW - 60_000, activeTimeout: 0, rx: 0, tx: 0,
    clientConnected: true, ...overrides
} as TunnelingStatus);

const view = (o: Options, s: TunnelingStatus | undefined, loaded = true) => tunnelRowView({option: o, status: s, loaded, meId: ME, serverTime: NOW});
const text = (o: Options, s: TunnelingStatus | undefined, loaded = true) => view(o, s, loaded).parts.map((part) => part.text).join(" · ");

describe("tunnelTitle", () => {
    test("이름이 있으면 이름이다", () => {
        expect(tunnelTitle(option({name: "office ssh"}))).toBe("office ssh");
    });
    test("없으면 포트와 목적지다", () => {
        expect(tunnelTitle(option())).toBe(":2222 → 10.0.0.5:22");
    });
    test("목적지 포트가 없으면 뺀다", () => {
        expect(tunnelTitle(option({destinationPort: undefined}))).toBe(":2222 → 10.0.0.5");
    });
});

describe("formatEnds — 시각 형식", () => {
    test("같은 언어의 Intl.DateTimeFormat 을 다시 만들지 않는다", () => {
        const ko = translator("ko");
        formatEnds(NOW + 60_000, NOW, ko);
        const created = jest.spyOn(Intl, "DateTimeFormat");
        try {
            expect(formatEnds(NOW + 60_000, NOW, ko)).toBe(formatEnds(NOW + 60_000, NOW, ko));
            expect(created).not.toHaveBeenCalled();
        } finally {
            created.mockRestore();
        }
    });
});

describe("#344 formatRemaining — 남은 시간", () => {
    test.each([
        [0, "0m 00s left"], [-5, "0m 00s left"], [5, "0m 05s left"], [3000, "50m 00s left"], [3599, "59m 59s left"],
        [3600, "1h 0m left"], [2 * 3600 + 13 * 60 + 59, "2h 13m left"], [86_399, "23h 59m left"], [26 * 3600, "1d 2h left"], [2 * 86_400 + 3 * 3600 + 59, "2d 3h left"],
    ])("%i 초 → %s", (seconds, expected) => {
        expect(formatRemaining(seconds)).toBe(expected);
    });
});

describe("#344 formatEnds — 종료 시각", () => {
    test("오늘이면 시:분만 보인다", () => {
        expect(formatEnds(NOW + 90 * 60_000, NOW)).toBe("ends 18:30");
    });
    test("다른 날이면 월/일을 함께 보인다", () => {
        expect(formatEnds(NOW + 26 * 3600_000, NOW)).toBe("ends 1/16 19:00");
    });
    test("자정 직전과 직후를 구분한다", () => {
        expect(formatEnds(NOW + 6 * 3600_000 + 59 * 60_000, NOW)).toBe("ends 23:59");
        expect(formatEnds(NOW + 7 * 3600_000, NOW)).toBe("ends 1/16 00:00");
    });
});

describe("#344 clockOf — 켜진 터널의 시계", () => {
    test("꺼진 터널과 상태가 없으면 시계가 없다", () => {
        expect(clockOf(status({active: false}), NOW)).toBeUndefined();
        expect(clockOf(undefined, NOW)).toBeUndefined();
        expect(clockOf(status({online: false}), NOW)).toBeUndefined();
    });
    test("무제한이면 숫자 없이 도는 시계다", () => {
        expect(clockOf(status({activeTimeout: 0}), NOW)).toEqual({kind: "unlimited", label: "No time limit"});
    });
    test("제한이 있으면 남은 비율·남은 시간·종료 시각을 준다 (AC-1)", () => {
        const clock = clockOf(status({activeStart: NOW - 600_000, activeTimeout: 3600}), NOW);
        expect(clock).toEqual({kind: "limited", fraction: 3000 / 3600, left: "50m 00s left", ends: "ends 17:50", warn: false,
            label: "50m 00s left, ends 17:50"});
    });
    test("남은 시간이 10분 이하이면 경고다 (AC-3)", () => {
        expect(clockOf(status({activeStart: NOW, activeTimeout: 9 * 60}), NOW)).toMatchObject({warn: true, label: "Ending soon, 9m 00s left, ends 17:09"});
        expect(clockOf(status({activeStart: NOW, activeTimeout: 10 * 60}), NOW)).toMatchObject({warn: true});
        expect(clockOf(status({activeStart: NOW, activeTimeout: 11 * 60}), NOW)).toMatchObject({warn: false});
    });
    test("만료 직후에는 비율 0 과 0m 00s 다", () => {
        expect(clockOf(status({activeStart: NOW - 20_000, activeTimeout: 10}), NOW)).toMatchObject({fraction: 0, left: "0m 00s left", warn: true});
    });
    test("서버 시각만 쓴다: 브라우저 시각과 무관하다 (AC-5)", () => {
        const before = clockOf(status({activeStart: NOW - 600_000, activeTimeout: 3600}), NOW);
        const realNow = Date.now;
        Date.now = () => realNow() + 3600_000;
        try {
            expect(clockOf(status({activeStart: NOW - 600_000, activeTimeout: 3600}), NOW)).toEqual(before);
        } finally {
            Date.now = realNow;
        }
    });
    test("26시간 남았고 종료일이 다음 날이면 날짜가 붙는다 (AC-6)", () => {
        expect(clockOf(status({activeStart: NOW, activeTimeout: 26 * 3600}), NOW)).toMatchObject({left: "1d 2h left", ends: "ends 1/16 19:00"});
    });
});

// 이슈 349 FR-6 — 이슈 344 AC-7. 언어는 마지막 인자로 넘긴다. 넘기지 않으면 앱이 시작할 때 정한 언어(테스트에서는 영어)다.
describe("이슈 349 한국어 시계", () => {
    const ko = translator("ko");

    test.each([
        [3000, "50분 00초 남음"], [5, "0분 05초 남음"], [2 * 3600 + 13 * 60, "2시간 13분 남음"], [26 * 3600, "1일 2시간 남음"],
    ])("%i 초 → %s", (seconds, expected) => {
        expect(formatRemaining(seconds, ko)).toBe(expected);
    });

    test("종료 시각은 같은 날이면 시:분, 다른 날이면 월·일을 붙인다", () => {
        expect(formatEnds(NOW + 90 * 60_000, NOW, ko)).toBe("18:30 종료");
        expect(formatEnds(NOW + 7 * 3600_000, NOW, ko)).toBe("1월 16일 00:00 종료");
    });

    test("시계 이름", () => {
        expect(clockOf(status({activeTimeout: 0}), NOW, ko)).toEqual({kind: "unlimited", label: "시간 제한 없음"});
        expect(clockOf(status({activeStart: NOW - 600_000, activeTimeout: 3600}), NOW, ko)).toMatchObject({
            left: "50분 00초 남음", ends: "17:50 종료", label: "50분 00초 남음, 17:50 종료"});
        expect(clockOf(status({activeStart: NOW, activeTimeout: 9 * 60}), NOW, ko)).toMatchObject({label: "곧 종료, 9분 00초 남음, 17:09 종료"});
    });

    test("영어를 넘겨도 지금과 같다", () => {
        const en = translator("en");
        expect(formatRemaining(3000, en)).toBe("50m 00s left");
        expect(formatEnds(NOW + 26 * 3600_000, NOW, en)).toBe("ends 1/16 19:00");
        expect(clockOf(status({activeTimeout: 0}), NOW, en)).toEqual({kind: "unlimited", label: "No time limit"});
    });
});

describe("tunnelRowView", () => {
    test("상태를 아직 읽지 못했으면 Checking… 이고 스위치는 비활성이다", () => {
        expect(view(option(), undefined, false)).toMatchObject({control: "disabled", checked: false, parts: [{text: "Checking…", muted: true}]});
    });

    test("#344 자물쇠 줄도 켜져 있으면 시계가 있고, 꺼졌거나 열리지 않았으면 없다 (AC-8)", () => {
        expect(view(option({editable: false}), status({activeStart: NOW - 600_000, activeTimeout: 3600})).clock).toMatchObject({kind: "limited", left: "50m 00s left"});
        expect(view(option({editable: false}), status({active: false})).clock).toBeUndefined();
        expect(view(option({editable: false}), status({online: false})).clock).toBeUndefined();
        expect(view(option(), undefined, false).clock).toBeUndefined();
    });

    test("고칠 수 없으면 자물쇠이고 view only 를 붙인다", () => {
        expect(view(option({editable: false}), status())).toMatchObject({control: "lock", checked: true});
        expect(text(option({editable: false}), status())).toBe("On · view only");
        expect(text(option({editable: false}), status({active: false}))).toBe("Off · view only");
        expect(text(option({editable: false}), status({online: false}))).toBe("Unavailable · view only");
        expect(text(option({editable: false}), undefined)).toBe("Unavailable · view only");
    });

    // 이슈 347 FR-12: 켤 수 있으면(toggleable) 스위치, 아니면 자물쇠다. 고칠 수 없으면 편집 화면으로 가지 않는다.
    test("이슈 347: 고칠 수 없어도 켤 수 있으면 스위치이고 view only 를 붙이지 않으며 편집 링크가 없다", () => {
        const shared = option({editable: false, toggleable: true, owner: {id: "u_alice", username: "alice"}});
        expect(view(shared, status())).toMatchObject({control: "switch", checked: true, link: false});
        expect(text(shared, status())).toBe("On · @alice");
    });

    test("이슈 347: 켤 수도 없으면 자물쇠이고 편집 링크가 없다", () => {
        expect(view(option({editable: false, toggleable: false}), status())).toMatchObject({control: "lock", link: false});
        expect(text(option({editable: false, toggleable: false}), status())).toBe("On · view only");
    });

    test("이슈 347: 고칠 수 있으면 편집 링크가 있다. toggleable 이 없는 옛 응답은 editable 을 따른다", () => {
        expect(view(option({editable: true, toggleable: true}), status())).toMatchObject({control: "switch", link: true});
        expect(view(option(), status())).toMatchObject({control: "switch", link: true});
        expect(view(option({editable: false}), status())).toMatchObject({control: "lock", link: false});
        expect(view(option({editable: false, toggleable: true}), undefined, false)).toMatchObject({control: "disabled", link: false});
    });

    test("상태 목록에 포트가 없으면 Not running(경고)이다", () => {
        expect(view(option(), undefined)).toMatchObject({control: "disabled", checked: false, parts: [{text: "Not running", warn: true}]});
    });

    test("리스너가 열리지 않았으면 Can't open port(경고)이다", () => {
        expect(view(option(), status({online: false}))).toMatchObject({control: "disabled", parts: [{text: "Can't open port 2222", warn: true}]});
    });

    test("꺼져 있으면 Off, 클라이언트가 없으면 client offline 을 붙인다", () => {
        expect(view(option(), status({active: false}))).toMatchObject({control: "switch", checked: false});
        expect(text(option(), status({active: false}))).toBe("Off");
        expect(text(option(), status({active: false, clientConnected: false}))).toBe("Off · client offline");
    });

    test("켜져 있으면 On 에 클라이언트·연결 수·남은 시간을 붙인다", () => {
        expect(view(option(), status())).toMatchObject({control: "switch", checked: true});
        expect(text(option(), status())).toBe("On");
        expect(text(option(), status({sessions: 1}))).toBe("On · 1 connection");
        // #344: 남은 시간은 상태 줄이 아니라 시계 줄에 보인다.
        expect(text(option(), status({sessions: 2, activeStart: NOW, activeTimeout: 4800}))).toBe("On · 2 connections");
        expect(view(option(), status({sessions: 2, activeStart: NOW, activeTimeout: 4800})).clock).toMatchObject({kind: "limited", left: "1h 20m left"});
        const offline = view(option(), status({clientConnected: false}));
        expect(offline.parts).toEqual([{text: "On"}, {text: "client offline", warn: true}]);
    });

    test("clientConnected 가 없는 옛 서버 응답은 연결된 것으로 본다", () => {
        const legacy = status();
        delete (legacy as {clientConnected?: boolean}).clientConnected;
        expect(text(option(), legacy)).toBe("On");
    });

    test("남의 터널이면 소유자를, 인증서를 검증하지 않으면 경고를 붙인다", () => {
        expect(text(option({owner: {id: "u_alice", username: "alice"}}), status())).toBe("On · @alice");
        expect(text(option({owner: {id: "system:migrated"}}), status())).toBe("On · migrated");
        expect(text(option({owner: {id: "u_gone"}}), status())).toBe("On · u_gone");
        const cert = view(option({tls: true, allowSelfSignedDestinationCert: true}), status());
        expect(cert.parts.at(-1)).toEqual({text: "cert not verified", warn: true, title: "The client does not verify the destination server certificate."});
    });
});

describe("undoTimeoutOf — 끄기를 되돌릴 때의 timeout", () => {
    test("기한이 없었으면 0(무기한)이다", () => {
        expect(undoTimeoutOf(status({activeTimeout: 0}), NOW)).toBe(0);
    });
    test("기한이 있었으면 남은 초(올림)다", () => {
        expect(undoTimeoutOf(status({activeStart: NOW - 1_500, activeTimeout: 10}), NOW)).toBe(9);
    });
    test("기한이 지났으면 되돌리지 않는다(undefined)", () => {
        expect(undoTimeoutOf(status({activeStart: NOW - 10_000, activeTimeout: 10}), NOW)).toBeUndefined();
    });
});

// 이슈 349 FR-8 — 상태 줄의 문구도 정한 언어로 만든다. 언어는 마지막 인자로 넘긴다.
describe("이슈 349 한국어 상태 줄", () => {
    const ko = translator("ko");
    const koView = (o: Options, s: TunnelingStatus | undefined, loaded = true) => tunnelRowView({option: o, status: s, loaded, meId: ME, serverTime: NOW}, ko);
    const koText = (o: Options, s: TunnelingStatus | undefined, loaded = true) => koView(o, s, loaded).parts.map((part) => part.text).join(" · ");

    test("상태를 읽기 전, 리스너가 없을 때, 상태가 없을 때", () => {
        expect(koText(option(), undefined, false)).toBe("확인 중…");
        expect(koText(option(), status({online: false}))).toBe("2222 포트를 열 수 없음");
        expect(koText(option(), undefined)).toBe("실행 중이 아님");
    });

    test("켜짐·꺼짐과 클라이언트 연결, 연결 수", () => {
        expect(koText(option(), status({active: false, clientConnected: false}))).toBe("꺼짐 · 클라이언트 연결 끊김");
        expect(koText(option(), status({sessions: 2, clientConnected: false}))).toBe("켜짐 · 클라이언트 연결 끊김 · 연결 2개");
    });

    test("보기만 가능한 터널", () => {
        expect(koText(option({editable: false, toggleable: false}), status())).toBe("켜짐 · 보기만 가능");
        expect(koText(option({editable: false, toggleable: false}), status({online: false}))).toBe("사용할 수 없음 · 보기만 가능");
    });

    test("옮겨 온 터널의 소유자와 인증서 경고", () => {
        expect(koText(option({owner: {id: "system:migrated"}}), status())).toBe("켜짐 · 업그레이드 전 터널");
        const cert = koView(option({tls: true, allowSelfSignedDestinationCert: true}), status());
        expect(cert.parts.at(-1)).toEqual({text: "인증서 확인 안 함", warn: true, title: "클라이언트가 대상 서버의 인증서를 확인하지 않습니다."});
    });

    test("켜진 터널의 시계도 같은 언어다", () => {
        expect(koView(option(), status({activeStart: NOW, activeTimeout: 3000})).clock).toMatchObject({left: "50분 00초 남음"});
    });
});
