import {prefixBucketOf, rateLimitBucketOf} from "../../../../src/server/security/ConnectionRateLimiter";

// #288 — IPv6 그룹 펴기를 공용 함수로 옮겨도 버킷 문자열은 그대로여야 한다. 아래 값은 옮기기 전 결과다.
describe("rateLimitBucketOf (#288)", () => {
    it.each([
        ["203.0.113.7", "203.0.113.7"],
        ["::ffff:203.0.113.7", "203.0.113.7"],
        ["::FFFF:203.0.113.7", "203.0.113.7"],
        ["::", "0:0:0:0::/64"],
        ["2001:DB8::1", "2001:db8:0:0::/64"],
        ["2001:db8:0:0::/64", "2001:db8:0:0::/64"],
        ["2001:0db8:00ab:0001:1:2:3:4", "2001:db8:ab:1::/64"],
        ["64:ff9b::1.2.3.4", "64:ff9b:0:0::/64"],
        ["1:2:3::4.5.6.7", "1:2:3:0::/64"],
        ["::1.2.3.4", "0:0:0:0::/64"],
        ["fe80::1%eth0", "fe80:0:0:0::/64"]
    ])("%s 의 버킷은 %s 다", (input, expected) => {
        expect(rateLimitBucketOf(input)).toBe(expected);
    });

    // 형식이 틀린 문자열을 억지로 IPv6 로 읽으면 관계없는 버킷(예: foo:bar → f:ba:0:0::/64)과 겹친다.
    // 일시 차단 해제 API 가 사용자 입력을 그대로 넘기므로, IPv6 가 아닌 문자열은 바꾸지 않고 돌려준다.
    it.each([["foo:bar"], ["zz::1"], ["1:2"], [":::"], ["1:2:3:4:5:6:7:8:9"], ["abc"], ["g::"]])("IPv6 가 아닌 %s 는 그대로 돌려준다", (input) => {
        expect(rateLimitBucketOf(input)).toBe(input);
    });

    it("/64 버킷의 /48 은 그대로다", () => {
        expect(prefixBucketOf(rateLimitBucketOf("2001:db8:7:3::1"))).toBe("2001:db8:7::/48");
    });
});
