import type {Options, TunnelingStatus} from "../../admin/src/controller/Options";
import {ipLimitView, withIpResult} from "../../admin/src/screens/parts/ipLimit";
import {translator} from "../../admin/src/i18n";

// 이슈 348 FR-16·FR-17·FR-18 — 터널 목록 줄의 IP 제한 토글과 갱신 버튼(순수 함수). 화면은 이 결과를 그리기만 한다.

const option = (overrides: Partial<Options> = {}): Options => ({
    forwardPort: 2222, protocol: "tcp", destinationAddress: "10.0.0.5", destinationPort: 22, editable: true, toggleable: true,
    activatorIpOnly: false, ...overrides
} as Options);

const status = (overrides: Partial<TunnelingStatus> = {}): TunnelingStatus => ({
    port: 2222, online: true, sessions: 0, uptime: 0, active: true, activeStart: 0, activeTimeout: 0, rx: 0, tx: 0,
    activatorIpOnly: false, myAllowedIp: null, allowedIpCount: 0, ...overrides
} as TunnelingStatus);

const ON_MINE = {activatorIpOnly: true, myAllowedIp: "203.0.113.5", allowedIpCount: 1};

describe("ipLimitView", () => {
    test("켜기 권한이 없는 줄(자물쇠)에는 없다 (FR-16)", () => {
        expect(ipLimitView({option: option({toggleable: false, editable: false}), status: status(), requesterIp: null})).toBeUndefined();
    });

    test("옛 서버 응답(toggleable 없음)은 editable 을 따른다", () => {
        expect(ipLimitView({option: option({toggleable: undefined, editable: false}), status: status(), requesterIp: null})).toBeUndefined();
        expect(ipLimitView({option: option({toggleable: undefined, editable: true}), status: status(), requesterIp: null})).toBeDefined();
    });

    test("꺼져 있으면 회색 'IP limit off' 이고 누를 수 있으며 갱신 버튼은 누를 수 없다 (FR-16·FR-17)", () => {
        const view = ipLimitView({option: option(), status: status(), requesterIp: "203.0.113.5"})!;
        expect(view).toMatchObject({on: false, text: "IP limit off", extra: undefined, warn: false, pressable: true, locked: false,
            label: "IP limit, off"});
        expect(view.refresh).toMatchObject({enabled: false, emphasized: false, label: "Update to my IP"});
    });

    test("켜져 있으면 내 허용 IP 를 보이고, 다른 사용자 항목이 있으면 +N 을 붙인다 (FR-16·FR-18)", () => {
        const view = ipLimitView({option: option(), status: status({...ON_MINE, allowedIpCount: 3}), requesterIp: "203.0.113.5"})!;
        expect(view).toMatchObject({on: true, text: "203.0.113.5", extra: "+2", warn: false, pressable: true, locked: false});
        expect(view.label).toBe("IP limit, on, allowed IP 203.0.113.5, and 2 more");
        expect(view.title).toBe(view.label);
        expect(view.refresh).toMatchObject({enabled: true, emphasized: false});
    });

    test("보조 기술용 이름은 스펙의 예와 같다 (FR-18)", () => {
        expect(ipLimitView({option: option(), status: status(ON_MINE), requesterIp: null})!.label).toBe("IP limit, on, allowed IP 203.0.113.5");
    });

    test("내 항목이 없으면 'My IP not set' 을 경고색으로 보인다 (FR-16)", () => {
        const view = ipLimitView({option: option(), status: status({activatorIpOnly: true, myAllowedIp: null, allowedIpCount: 1}), requesterIp: "203.0.113.5"})!;
        expect(view).toMatchObject({text: "My IP not set", extra: "+1", warn: true});
        expect(view.label).toBe("IP limit, on, your IP is not allowed, and 1 more");
        expect(view.refresh).toMatchObject({enabled: true, emphasized: true});
    });

    test("지금 요청자 IP 와 내 허용 IP 가 다르면 갱신 버튼을 강조한다 (FR-17)", () => {
        expect(ipLimitView({option: option(), status: status(ON_MINE), requesterIp: "198.51.100.1"})!.refresh.emphasized).toBe(true);
        // 요청자 IP 를 모르면 강조하지 않는다.
        expect(ipLimitView({option: option(), status: status(ON_MINE), requesterIp: null})!.refresh.emphasized).toBe(false);
    });

    test("켜기 권한만 있으면 꺼진 토글은 눌러 켜고, 켜진 토글은 잠긴 켜짐이다. 갱신은 누를 수 있다 (FR-16·AC-14)", () => {
        const toggleOnly = option({editable: false, toggleable: true});
        expect(ipLimitView({option: toggleOnly, status: status(), requesterIp: null})).toMatchObject({pressable: true, locked: false});
        const locked = ipLimitView({option: toggleOnly, status: status(ON_MINE), requesterIp: null})!;
        expect(locked).toMatchObject({on: true, pressable: false, locked: true, text: "203.0.113.5"});
        expect(locked.label).toBe("IP limit, on, allowed IP 203.0.113.5, can't turn off");
        expect(locked.refresh.enabled).toBe(true);
    });

    test("터널이 꺼져 있거나 리스너가 없어도 토글과 갱신 버튼은 같은 규칙이다 (FR-2a·AC-10)", () => {
        for(const s of [status({...ON_MINE, active: false}), status({...ON_MINE, online: false})]) {
            const view = ipLimitView({option: option(), status: s, requesterIp: null})!;
            expect(view).toMatchObject({on: true, pressable: true});
            expect(view.refresh.enabled).toBe(true);
        }
    });

    test("상태를 아직 못 읽었으면 목록 응답의 값을 쓰고, 내 항목을 모르므로 경고하지 않는다", () => {
        const view = ipLimitView({option: option({activatorIpOnly: true}), status: undefined, requesterIp: "203.0.113.5"})!;
        expect(view).toMatchObject({on: true, text: "IP limit on", extra: undefined, warn: false, pressable: true, locked: false,
            label: "IP limit, on", title: "IP limit, on"});
        expect(view.refresh).toMatchObject({enabled: true, emphasized: false});
        expect(ipLimitView({option: option({activatorIpOnly: false}), status: undefined, requesterIp: null})).toMatchObject({on: false, text: "IP limit off"});
    });

    test("상태가 없어도 켜기 권한만 있으면 켜진 토글은 잠긴 켜짐이다", () => {
        const view = ipLimitView({option: option({activatorIpOnly: true, editable: false, toggleable: true}), status: undefined, requesterIp: null})!;
        expect(view).toMatchObject({on: true, warn: false, pressable: false, locked: true, label: "IP limit, on, can't turn off"});
    });

    test("요청 중이면 토글과 갱신 버튼을 누를 수 없다", () => {
        const view = ipLimitView({option: option(), status: status(ON_MINE), requesterIp: null, busy: true})!;
        expect(view.pressable).toBe(false);
        expect(view.refresh.enabled).toBe(false);
    });

    test("긴 IPv6 도 버튼 글자는 그대로 두고(줄임표는 CSS), 전체 주소를 이름과 title 에 둔다 (FR-17a)", () => {
        const ip = "2001:db8:85a3:1234:5678:8a2e:370:7334";
        const view = ipLimitView({option: option(), status: status({...ON_MINE, myAllowedIp: ip}), requesterIp: ip})!;
        expect(view.text).toBe(ip);
        expect(view.title).toContain(ip);
        expect(view.label).toContain(ip);
    });
});

describe("withIpResult", () => {
    test("상태 항목이 있으면 그 항목과 목록의 IP 제한을 함께 바꾼다", () => {
        const options = [option({forwardPort: 2222}), option({forwardPort: 3333})];
        const next = withIpResult({options, statuses: {2222: status()}}, 2222, {activatorIpOnly: true, myAllowedIp: "203.0.113.5"});
        expect(next.statuses[2222]).toMatchObject({activatorIpOnly: true, myAllowedIp: "203.0.113.5"});
        expect(next.options.map((o) => o.activatorIpOnly)).toEqual([true, false]);
    });

    test("상태 항목이 아직 없어도 목록의 IP 제한은 바꾸고, 상태 항목은 만들지 않는다", () => {
        const options = [option({forwardPort: 2222})];
        const next = withIpResult({options, statuses: {}}, 2222, {activatorIpOnly: true, myAllowedIp: "203.0.113.5"});
        expect(next.options[0].activatorIpOnly).toBe(true);
        expect(next.statuses).toEqual({});
        expect(ipLimitView({option: next.options[0], status: next.statuses[2222], requesterIp: null})).toMatchObject({on: true, warn: false});
    });

    test("IP 제한을 바꾸지 않는 결과(내 IP 갱신)는 목록을 그대로 둔다", () => {
        const options = [option({forwardPort: 2222, activatorIpOnly: true})];
        const next = withIpResult({options, statuses: {2222: status(ON_MINE)}}, 2222, {myAllowedIp: "198.51.100.1"});
        expect(next.options).toBe(options);
        expect(next.statuses[2222].myAllowedIp).toBe("198.51.100.1");
    });
});

// 이슈 349 FR-8 — IP 제한 토글의 글자와 보조 기술용 이름도 정한 언어로 만든다. 언어는 마지막 인자로 넘긴다.
describe("이슈 349 한국어 IP 제한", () => {
    const ko = translator("ko");

    test("꺼져 있을 때", () => {
        const view = ipLimitView({option: option(), status: status(), requesterIp: null}, ko)!;
        expect(view).toMatchObject({text: "IP 제한 꺼짐", label: "IP 제한, 꺼짐", title: "IP 제한, 꺼짐"});
        expect(view.refresh.label).toBe("내 IP로 바꾸기");
    });

    test("켜져 있을 때의 이름", () => {
        expect(ipLimitView({option: option(), status: status({...ON_MINE, allowedIpCount: 3}), requesterIp: null}, ko)!.label)
            .toBe("IP 제한, 켜짐, 허용 IP 203.0.113.5, 그 밖에 2개");
        const none = ipLimitView({option: option(), status: status({activatorIpOnly: true, myAllowedIp: null, allowedIpCount: 1}), requesterIp: null}, ko)!;
        expect(none).toMatchObject({text: "내 IP 없음", label: "IP 제한, 켜짐, 내 IP는 허용되지 않음, 그 밖에 1개"});
        expect(ipLimitView({option: option({editable: false, toggleable: true}), status: status(ON_MINE), requesterIp: null}, ko)!.label)
            .toBe("IP 제한, 켜짐, 허용 IP 203.0.113.5, 끌 수 없음");
    });

    test("상태를 읽기 전", () => {
        expect(ipLimitView({option: option({activatorIpOnly: true}), status: undefined, requesterIp: null}, ko)).toMatchObject({text: "IP 제한 켜짐", label: "IP 제한, 켜짐"});
    });
});
