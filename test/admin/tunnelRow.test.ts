import type {Options, TunnelingStatus} from "../../admin/src/controller/Options";
import {formatLeft, tunnelRowView, tunnelTitle, undoTimeoutOf} from "../../admin/src/screens/parts/tunnelRow";

// #338 REQ-5·REQ-8·REQ-15 — 터널 목록 한 줄의 제목·상태 줄·스위치(순수 함수).

const NOW = 1_800_000_000_000;
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

describe("formatLeft", () => {
    test.each([[30, "<1m left"], [60, "1m left"], [59 * 60 + 59, "59m left"], [3600, "1h 0m left"], [4800, "1h 20m left"], [26 * 3600 + 60, "26h 1m left"]])(
        "%i 초 → %s", (seconds, expected) => {
            expect(formatLeft(seconds)).toBe(expected);
        });
});

describe("tunnelRowView", () => {
    test("상태를 아직 읽지 못했으면 Checking… 이고 스위치는 비활성이다", () => {
        expect(view(option(), undefined, false)).toMatchObject({control: "disabled", checked: false, parts: [{text: "Checking…", muted: true}]});
    });

    test("고칠 수 없으면 자물쇠이고 view only 를 붙인다", () => {
        expect(view(option({editable: false}), status())).toMatchObject({control: "lock", checked: true});
        expect(text(option({editable: false}), status())).toBe("On · view only");
        expect(text(option({editable: false}), status({active: false}))).toBe("Off · view only");
        expect(text(option({editable: false}), status({online: false}))).toBe("Unavailable · view only");
        expect(text(option({editable: false}), undefined)).toBe("Unavailable · view only");
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
        expect(text(option(), status({sessions: 2, activeStart: NOW, activeTimeout: 4800}))).toBe("On · 2 connections · 1h 20m left");
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
