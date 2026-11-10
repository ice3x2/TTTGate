import {
    activatorIpOnlyOf,
    activatorIpsOf,
    allowedActivatorIps,
    canonicalIp,
    isActivatorIpAllowed,
    placeRequesterIp,
    requesterIpOf,
    resolveActivatorIpOnly,
    withActivatorIp,
    withActivatorIps,
    withoutActivatorIps
} from "../../../../src/server/security/ActivatorIps";

// 이슈 348 — 터널을 켠 사람의 IP 만 받는 판정과 허용 IP 목록 갱신 규칙. 저장소를 모르는 순수 함수다.
describe("ActivatorIps (이슈 348)", () => {
    describe("activatorIpOnlyOf (FR-1)", () => {
        it("필드가 없거나 true 가 아니면 꺼짐으로 읽는다", () => {
            expect(activatorIpOnlyOf({})).toBe(false);
            expect(activatorIpOnlyOf({activatorIpOnly: false})).toBe(false);
            expect(activatorIpOnlyOf({activatorIpOnly: "true"})).toBe(false);
            expect(activatorIpOnlyOf({activatorIpOnly: true})).toBe(true);
        });
    });

    describe("resolveActivatorIpOnly (FR-1·FR-12)", () => {
        it("새 터널은 본문에 없으면 true 다", () => {
            expect(resolveActivatorIpOnly(undefined, undefined)).toEqual({success: true, value: true});
            expect(resolveActivatorIpOnly(false, undefined)).toEqual({success: true, value: false});
        });

        it("기존 터널은 본문에 없으면 저장된 값을 그대로 둔다", () => {
            expect(resolveActivatorIpOnly(undefined, false)).toEqual({success: true, value: false});
            expect(resolveActivatorIpOnly(undefined, true)).toEqual({success: true, value: true});
            expect(resolveActivatorIpOnly(true, false)).toEqual({success: true, value: true});
        });

        it("boolean 이 아니면 422 activator_ip_only_invalid 다", () => {
            expect(resolveActivatorIpOnly("yes", false)).toMatchObject({success: false, status: 422, code: "activator_ip_only_invalid"});
            expect(resolveActivatorIpOnly(null, undefined)).toMatchObject({success: false, status: 422});
        });
    });

    describe("activatorIpsOf (FR-6)", () => {
        it("없으면 빈 목록이고, 손으로 고친 파일의 문자열 아닌 값과 배열은 버린다", () => {
            expect(activatorIpsOf({})).toEqual({});
            expect(activatorIpsOf({activatorIps: ["1.2.3.4"]})).toEqual({});
            expect(activatorIpsOf({activatorIps: {u_a: "1.2.3.4", u_b: 5, u_c: ""}})).toEqual({u_a: "1.2.3.4"});
        });

        it("프로토타입 키를 항목으로 받지 않는다", () => {
            const parsed = JSON.parse('{"__proto__": "6.6.6.6", "u_a": "1.2.3.4"}');
            expect(Object.keys(activatorIpsOf({activatorIps: parsed}))).toEqual(["u_a"]);
        });
    });

    describe("withActivatorIps", () => {
        it("비면 필드를 지워 옛 설정과 같은 모양을 지킨다", () => {
            const option: {activatorIps?: Record<string, string>} = {activatorIps: {u_a: "1.2.3.4"}};
            expect(withActivatorIps(option, {})).not.toHaveProperty("activatorIps");
            expect(withActivatorIps(option, {u_b: "5.6.7.8"}).activatorIps).toEqual({u_b: "5.6.7.8"});
        });
    });

    describe("canonicalIp·requesterIpOf (FR-7)", () => {
        it("IPv4-mapped IPv6 는 IPv4 로, IPv6 는 소문자로 바꾼다 (AC-8)", () => {
            expect(canonicalIp("::ffff:203.0.113.5")).toBe("203.0.113.5");
            expect(canonicalIp("203.0.113.5")).toBe("203.0.113.5");
            expect(canonicalIp("2001:DB8::1")).toBe("2001:db8::1");
        });

        it("IPv6 는 표기와 관계없이 RFC 5952 압축형으로 바꿔 소켓 주소와 같아진다", () => {
            expect(canonicalIp("2001:DB8:0:0::1")).toBe("2001:db8::1");
            expect(canonicalIp("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
            expect(canonicalIp("fe80::1%eth0")).toBe("fe80::1");
            expect(canonicalIp("::ffff:c000:0201")).toBe("192.0.2.1");
            expect(requesterIpOf("2001:DB8:0:0::1")).toBe("2001:db8::1");
            expect(isActivatorIpAllowed(new Set([canonicalIp("2001:DB8:0:0::1")]), "2001:db8::1")).toBe(true);
        });

        it("요청자 주소를 모르면(unknown·빈 값) 요청자 IP 가 없다", () => {
            expect(requesterIpOf("unknown")).toBeUndefined();
            expect(requesterIpOf("")).toBeUndefined();
            expect(requesterIpOf(undefined)).toBeUndefined();
            expect(requesterIpOf("::ffff:198.51.100.7")).toBe("198.51.100.7");
        });
    });

    describe("허용 IP 목록 갱신 규칙 (FR-3·FR-4·FR-5)", () => {
        it("요청자 자신의 항목만 넣거나 바꾸고 원본은 바꾸지 않는다 (AC-4)", () => {
            const stored = {u_a: "1.1.1.1", u_b: "2.2.2.2"};
            expect(withActivatorIp(stored, "u_a", "3.3.3.3")).toEqual({u_a: "3.3.3.3", u_b: "2.2.2.2"});
            expect(withActivatorIp(stored, "u_c", "4.4.4.4")).toEqual({u_a: "1.1.1.1", u_b: "2.2.2.2", u_c: "4.4.4.4"});
            expect(stored).toEqual({u_a: "1.1.1.1", u_b: "2.2.2.2"});
        });

        it("빠진 사용자의 항목만 지운다", () => {
            expect(withoutActivatorIps({u_a: "1.1.1.1", u_b: "2.2.2.2"}, ["u_b", "u_z"])).toEqual({u_a: "1.1.1.1"});
        });
    });

    describe("placeRequesterIp (FR-3·FR-4·FR-12)", () => {
        it("replace 는 켜기·갱신이다. 요청자 항목을 지금 IP 로 넣거나 바꾸고 이전 값을 알려 준다", () => {
            expect(placeRequesterIp({u_a: "1.1.1.1"}, "u_a", "2.2.2.2", "replace"))
                .toEqual({ips: {u_a: "2.2.2.2"}, before: "1.1.1.1", after: "2.2.2.2", changed: true});
            expect(placeRequesterIp({}, "u_a", "2.2.2.2", "replace"))
                .toEqual({ips: {u_a: "2.2.2.2"}, before: null, after: "2.2.2.2", changed: true});
        });

        it("add-if-missing 는 IP 제한을 켤 때다. 요청자 항목이 이미 있으면 그대로 둔다", () => {
            expect(placeRequesterIp({u_a: "1.1.1.1"}, "u_a", "2.2.2.2", "add-if-missing"))
                .toEqual({ips: {u_a: "1.1.1.1"}, before: "1.1.1.1", after: "1.1.1.1", changed: false});
            expect(placeRequesterIp({u_b: "3.3.3.3"}, "u_a", "2.2.2.2", "add-if-missing"))
                .toEqual({ips: {u_b: "3.3.3.3", u_a: "2.2.2.2"}, before: null, after: "2.2.2.2", changed: true});
        });

        it("같은 IP 로 바꾸면 바뀐 것이 없다", () => {
            expect(placeRequesterIp({u_a: "1.1.1.1"}, "u_a", "1.1.1.1", "replace")).toMatchObject({changed: false});
        });

        it("요청자 IP 가 없으면 목록을 바꾸지 않는다", () => {
            expect(placeRequesterIp({u_a: "1.1.1.1"}, "u_a", undefined, "replace"))
                .toEqual({ips: {u_a: "1.1.1.1"}, before: "1.1.1.1", after: "1.1.1.1", changed: false});
        });
    });

    describe("판정 (FR-5·FR-8·FR-9)", () => {
        it("켜기 권한이 있는 사용자의 항목만 허용 IP 로 쓴다 (AC-12)", () => {
            const allowed = allowedActivatorIps({u_a: "1.1.1.1", u_b: "2.2.2.2"}, (userId) => userId === "u_a");
            expect([...allowed]).toEqual(["1.1.1.1"]);
        });

        it("목록에 있는 IP 만 받고, 매핑 주소는 IPv4 와 같게 본다 (AC-8)", () => {
            const allowed = allowedActivatorIps({u_a: "203.0.113.5"}, () => true);
            expect(isActivatorIpAllowed(allowed, "203.0.113.5")).toBe(true);
            expect(isActivatorIpAllowed(allowed, "::ffff:203.0.113.5")).toBe(true);
            expect(isActivatorIpAllowed(allowed, "203.0.113.6")).toBe(false);
        });

        it("목록이 비어 있으면 모두 거부한다 (FR-9)", () => {
            expect(isActivatorIpAllowed(allowedActivatorIps({}, () => true), "203.0.113.5")).toBe(false);
        });

        it("연결 IP 를 모르면 거부한다 (FR-8)", () => {
            expect(isActivatorIpAllowed(allowedActivatorIps({u_a: "1.1.1.1"}, () => true), undefined)).toBe(false);
            expect(isActivatorIpAllowed(allowedActivatorIps({u_a: "1.1.1.1"}, () => true), "")).toBe(false);
        });

        it("저장된 IP 가 매핑 주소나 대문자여도 같은 IP 로 본다", () => {
            const allowed = allowedActivatorIps({u_a: "::ffff:10.0.0.1", u_b: "2001:DB8::1"}, () => true);
            expect(isActivatorIpAllowed(allowed, "10.0.0.1")).toBe(true);
            expect(isActivatorIpAllowed(allowed, "2001:db8::1")).toBe(true);
        });
    });
});
