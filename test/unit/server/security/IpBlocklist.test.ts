import {
    addBlocklistEntry,
    dropBlocklistPort,
    dropOrphanBlocklistEntries,
    moveBlocklistPort,
    IpBlocklist,
    MAX_BLOCKLIST_ENTRIES,
    MAX_BLOCKLIST_NOTE_LENGTH,
    normalizeBlocklist,
    parseBlockedAddress,
    removeBlocklistEntry,
    withPortAlias
} from "../../../../src/server/security/IpBlocklist";
import {BlocklistEntry} from "../../../../src/types/TunnelingOption";

const entryOf = (address: string, port: number | null = null): BlocklistEntry =>
    ({address, port, note: "", createdAt: 1, createdBy: "admin"});

describe("parseBlockedAddress (#286 REQ-1·REQ-4 AC-2)", () => {
    it.each([
        ["203.0.113.7", "203.0.113.7"],
        ["  203.0.113.7 ", "203.0.113.7"],
        ["198.51.100.0/24", "198.51.100.0/24"],
        ["198.51.100.77/24", "198.51.100.0/24"],
        ["203.0.113.7/32", "203.0.113.7"],
        ["::ffff:203.0.113.7", "203.0.113.7"],
        ["2001:DB8:0:0::1", "2001:db8::1"],
        ["2001:db8:1:ff::/48", "2001:db8:1::/48"],
        ["2001:db8:0:0::/64", "2001:db8::/64"],
        ["2001:db8::1/128", "2001:db8::1"],
        ["2001:db8:1:8000::/49", "2001:db8:1:8000::/49"],
        ["2001:db8:1:ffff::/49", "2001:db8:1:8000::/49"],
        // 16진수로 쓴 IPv4-mapped 주소와 그 대역은 IPv4 로 쓴다. 그래야 IPv4 항목과 중복을 가린다.
        ["::ffff:cb00:7107", "203.0.113.7"],
        ["::FFFF:CB00:7100/120", "203.0.113.0/24"],
        ["::ffff:1.2.3.4/120", "1.2.3.0/24"]
    ])("%s 를 %s 로 정규화한다", (input, expected) => {
        expect(parseBlockedAddress(input)).toEqual({ok: true, address: expected});
    });

    it.each([
        [""], ["not-an-ip"], ["1.2.3"], ["1.2.3.256"], ["1.2.3.4/"], ["1.2.3.4/x"], ["1.2.3.4/33"], ["1.2.3.4/-1"],
        ["1.2.3.4/24/1"], ["2001:db8::/129"], ["fe80::1%eth0"], ["1.2.3.4/08"]
    ])("형식이 틀린 %p 는 거부한다", (input) => {
        expect(parseBlockedAddress(input)).toMatchObject({ok: false});
    });

    it.each([["0.0.0.0/0"], ["::/0"], ["::ffff:0:0/96"]])("모든 주소를 덮는 %s 는 거부한다", (input) => {
        expect(parseBlockedAddress(input)).toEqual({ok: false, message: "a range that covers every address cannot be blocked"});
    });

    it("문자열이 아니면 거부한다", () => {
        expect(parseBlockedAddress(123)).toMatchObject({ok: false});
        expect(parseBlockedAddress(undefined)).toMatchObject({ok: false});
    });
});

describe("IpBlocklist.isBlocked (#286 REQ-1·REQ-3)", () => {
    it("All tunnels 항목은 모든 포트에서 그 주소만 막는다", () => {
        const list = new IpBlocklist();
        list.configure([entryOf("203.0.113.7")]);
        expect(list.isBlocked(1111, "203.0.113.7")).toBe(true);
        expect(list.isBlocked(18080, "203.0.113.7")).toBe(true);
        expect(list.isBlocked(1111, "203.0.113.8")).toBe(false);
    });

    it("포트를 고른 항목은 그 포트만 막는다", () => {
        const list = new IpBlocklist();
        list.configure([entryOf("203.0.113.7", 18080)]);
        expect(list.isBlocked(18080, "203.0.113.7")).toBe(true);
        expect(list.isBlocked(1111, "203.0.113.7")).toBe(false);
    });

    it("IPv4 대역의 처음과 끝을 막고 밖은 막지 않는다", () => {
        const list = new IpBlocklist();
        list.configure([entryOf("198.51.100.0/24")]);
        expect(list.isBlocked(1, "198.51.100.0")).toBe(true);
        expect(list.isBlocked(1, "198.51.100.255")).toBe(true);
        expect(list.isBlocked(1, "198.51.101.0")).toBe(false);
    });

    it("IPv6 대역과 주소를 막는다", () => {
        const list = new IpBlocklist();
        list.configure([entryOf("2001:db8:1::/48"), entryOf("2001:db8:9::5")]);
        expect(list.isBlocked(1, "2001:db8:1:ffff::1")).toBe(true);
        expect(list.isBlocked(1, "2001:db8:2::1")).toBe(false);
        expect(list.isBlocked(1, "2001:db8:9::5")).toBe(true);
        expect(list.isBlocked(1, "2001:db8:9::6")).toBe(false);
    });

    // 리뷰 지적: Node 의 BlockList 는 IPv4 주소를 IPv6 규칙(IPv4-mapped 대역)과도 비교한다.
    it("IPv6 대역은 IPv4 주소를 막지 않는다", () => {
        const list = new IpBlocklist();
        list.configure([entryOf("::/8"), entryOf("::ffff:0:0/97"), entryOf("2001:db8::/32")]);
        expect(list.isBlocked(1, "203.0.113.7")).toBe(false);
        expect(list.isBlocked(1, "::ffff:203.0.113.7")).toBe(false);
        expect(list.isBlocked(1, "::1")).toBe(true);
        expect(list.isBlocked(1, "2001:db8::5")).toBe(true);
    });

    it("IPv4-mapped 주소로 들어와도 IPv4 항목에 걸린다", () => {
        const list = new IpBlocklist();
        list.configure([entryOf("203.0.113.7")]);
        expect(list.isBlocked(1, "::ffff:203.0.113.7")).toBe(true);
    });

    it("다시 구성하면 이전 항목은 풀린다", () => {
        const list = new IpBlocklist();
        list.configure([entryOf("203.0.113.7")]);
        list.configure([entryOf("203.0.113.8")]);
        expect(list.isBlocked(1, "203.0.113.7")).toBe(false);
        expect(list.isBlocked(1, "203.0.113.8")).toBe(true);
    });

    it("항목이 없으면 아무것도 막지 않고, 주소가 아닌 값도 막지 않는다", () => {
        const list = new IpBlocklist();
        expect(list.isBlocked(1, "203.0.113.7")).toBe(false);
        list.configure([entryOf("203.0.113.7")]);
        expect(list.isBlocked(1, "garbage")).toBe(false);
    });
});

describe("addBlocklistEntry (#286 REQ-4·REQ-5)", () => {
    // 포트를 고른 항목은 그 포트를 쓰는 터널이 있어야 한다. 이 표의 포트만 터널이 있다고 본다.
    const meta = {now: 1_000, createdBy: "admin", tunnelPorts: new Set([18080, 9000])};

    it("주소를 정규화하고 메모를 다듬어 끝에 붙인다", () => {
        const result = addBlocklistEntry([entryOf("203.0.113.1")], {address: "198.51.100.9/24", port: 18080, note: "  scanner  "}, meta);
        expect(result).toEqual({
            ok: true,
            entry: {address: "198.51.100.0/24", port: 18080, note: "scanner", createdAt: 1_000, createdBy: "admin"},
            entries: [entryOf("203.0.113.1"), {address: "198.51.100.0/24", port: 18080, note: "scanner", createdAt: 1_000, createdBy: "admin"}]
        });
    });

    it("포트와 메모가 없으면 All tunnels 와 빈 메모다", () => {
        const result = addBlocklistEntry([], {address: "203.0.113.7"}, meta);
        expect(result).toMatchObject({ok: true, entry: {address: "203.0.113.7", port: null, note: ""}});
    });

    it("원래 목록은 바꾸지 않는다", () => {
        const entries = [entryOf("203.0.113.1")];
        addBlocklistEntry(entries, {address: "203.0.113.7"}, meta);
        expect(entries).toEqual([entryOf("203.0.113.1")]);
    });

    it("같은 주소가 이미 있으면 포트가 달라도 duplicate 이고, 메시지에 기존 적용 범위를 쓴다", () => {
        expect(addBlocklistEntry([entryOf("203.0.113.7", 18080)], {address: "::ffff:203.0.113.7"}, meta))
            .toEqual({ok: false, code: "duplicate", message: "203.0.113.7 is already blocked on port 18080"});
        expect(addBlocklistEntry([entryOf("203.0.113.7")], {address: "203.0.113.7", port: 18080}, meta))
            .toEqual({ok: false, code: "duplicate", message: "203.0.113.7 is already blocked on all tunnels"});
    });

    // REQ-5 AC-1: 일시 차단에서 옮기면 All tunnels 항목이 된다. 포트 하나에만 걸린 항목은 그 자리에서 넓힌다.
    it("widen 이면 포트 하나에만 걸린 같은 주소를 그 자리에서 All tunnels 로 넓히고, 원래 메모·시각·사용자는 지킨다", () => {
        const scoped = {address: "203.0.113.7", port: 9000, note: "scanner", createdAt: 5, createdBy: "ops"};
        const entries = [entryOf("203.0.113.1"), scoped, entryOf("203.0.113.9")];
        const widened = {...scoped, port: null};
        expect(addBlocklistEntry(entries, {address: "203.0.113.7", note: "moved"}, {...meta, widen: true})).toEqual({
            ok: true,
            entry: widened,
            entries: [entryOf("203.0.113.1"), widened, entryOf("203.0.113.9")],
            widenedFrom: 9000
        });
    });

    it("widen 이어도 이미 All tunnels 이면 duplicate 이고, 목록이 가득 차도 넓힐 수 있다", () => {
        expect(addBlocklistEntry([entryOf("203.0.113.7")], {address: "203.0.113.7"}, {...meta, widen: true}))
            .toEqual({ok: false, code: "duplicate", message: "203.0.113.7 is already blocked on all tunnels"});
        const full = Array.from({length: MAX_BLOCKLIST_ENTRIES}, (_, i) => entryOf(`10.0.${Math.floor(i / 256)}.${i % 256}`, 9000));
        expect(addBlocklistEntry(full, {address: "10.0.0.5"}, {...meta, widen: true})).toMatchObject({ok: true, entry: {address: "10.0.0.5", port: null}});
    });

    it("상한에 이르면 full 이다", () => {
        const entries = Array.from({length: MAX_BLOCKLIST_ENTRIES}, (_, i) => entryOf(`10.0.${Math.floor(i / 256)}.${i % 256}`));
        expect(addBlocklistEntry(entries, {address: "203.0.113.7"}, meta))
            .toEqual({ok: false, code: "full", message: `the blocklist already has ${MAX_BLOCKLIST_ENTRIES} entries`});
    });

    it.each([
        [{address: "nope"}],
        [{address: "0.0.0.0/0"}],
        [{address: "203.0.113.7", port: 0}],
        [{address: "203.0.113.7", port: 65536}],
        [{address: "203.0.113.7", port: 1.5}],
        [{address: "203.0.113.7", port: "80"}],
        [{address: "203.0.113.7", note: 5}],
        [{address: "203.0.113.7", note: "x".repeat(MAX_BLOCKLIST_NOTE_LENGTH + 1)}]
    ])("잘못된 입력 %p 은 invalid 다", (request) => {
        expect(addBlocklistEntry([], request, meta)).toMatchObject({ok: false, code: "invalid"});
    });

    // 없는 터널에 건 항목은 나중에 그 포트로 만든 다른 터널에 걸린다(REQ-3 AC-2).
    it("그 포트를 쓰는 터널이 없으면 invalid 다", () => {
        expect(addBlocklistEntry([], {address: "203.0.113.7", port: 7777}, meta))
            .toEqual({ok: false, code: "invalid", message: "no tunnel uses port 7777"});
    });

    it("메모는 상한 길이까지 받는다", () => {
        expect(addBlocklistEntry([], {address: "203.0.113.7", note: "x".repeat(MAX_BLOCKLIST_NOTE_LENGTH)}, meta)).toMatchObject({ok: true});
    });
});

describe("removeBlocklistEntry (#286 REQ-4)", () => {
    it("다른 표기로 써도 같은 항목을 지운다", () => {
        const entries = [entryOf("203.0.113.7"), entryOf("2001:db8:1::/48")];
        expect(removeBlocklistEntry(entries, "2001:DB8:1:0::/48")).toEqual({removed: entryOf("2001:db8:1::/48"), entries: [entryOf("203.0.113.7")]});
    });

    it("없는 주소면 removed 가 없고 목록은 그대로다", () => {
        const entries = [entryOf("203.0.113.7")];
        expect(removeBlocklistEntry(entries, "not-an-ip")).toEqual({removed: undefined, entries});
    });
});

// 포트를 고른 항목은 터널을 따라간다. 외부 포트를 바꾸면 옮기고, 터널을 지우면 함께 지운다(REQ-2 AC-2, REQ-3 AC-2).
describe("moveBlocklistPort / dropBlocklistPort (#286)", () => {
    const entries = [entryOf("203.0.113.1"), entryOf("203.0.113.2", 1111), entryOf("203.0.113.3", 2222)];

    it("옛 포트의 항목만 새 포트로 옮기고 나머지는 그대로 둔다", () => {
        expect(moveBlocklistPort(entries, 1111, 3333)).toEqual([entryOf("203.0.113.1"), entryOf("203.0.113.2", 3333), entryOf("203.0.113.3", 2222)]);
        expect(entries[1].port).toBe(1111);
    });

    it("그 포트의 항목만 지운다", () => {
        expect(dropBlocklistPort(entries, 1111)).toEqual([entryOf("203.0.113.1"), entryOf("203.0.113.3", 2222)]);
    });

    it("그 포트의 항목이 없으면 같은 내용을 돌려준다", () => {
        expect(moveBlocklistPort(entries, 9999, 3333)).toEqual(entries);
        expect(dropBlocklistPort(entries, 9999)).toEqual(entries);
    });
});

describe("dropOrphanBlocklistEntries (#286 REQ-3 AC-2)", () => {
    it("터널이 없는 포트의 항목은 빼고 경고한다. All tunnels 항목은 그대로다", () => {
        const entries = [entryOf("203.0.113.1"), entryOf("203.0.113.2", 1111), entryOf("203.0.113.3", 2222)];
        expect(dropOrphanBlocklistEntries(entries, new Set([1111]))).toEqual({
            entries: [entryOf("203.0.113.1"), entryOf("203.0.113.2", 1111)],
            warnings: ["connectionSecurity.blocklist: no tunnel uses port 2222 for 203.0.113.3; ignored and dropped at the next save"]
        });
    });

    it("모두 터널이 있으면 같은 목록이고 경고가 없다", () => {
        const entries = [entryOf("203.0.113.2", 1111)];
        expect(dropOrphanBlocklistEntries(entries, new Set([1111]))).toEqual({entries, warnings: []});
    });
});

describe("withPortAlias (#286)", () => {
    it("그 포트의 항목을 별칭 포트에도 덧붙이고 다른 항목은 그대로 둔다", () => {
        const option = {geo: {mode: "off" as const, countries: [], applyToAdmin: true, unknownPolicy: "allow" as const},
            blocklist: [entryOf("203.0.113.1"), entryOf("203.0.113.2", 1111)]};
        expect(withPortAlias(option, 1111, 2222)?.blocklist).toEqual([entryOf("203.0.113.1"), entryOf("203.0.113.2", 1111), entryOf("203.0.113.2", 2222)]);
        expect(option.blocklist).toHaveLength(2);
    });

    it("설정이 없으면 그대로 돌려준다", () => {
        expect(withPortAlias(undefined, 1111, 2222)).toBeUndefined();
    });
});

describe("normalizeBlocklist (#286 REQ-2 AC-3)", () => {
    it("없으면 빈 목록이다", () => {
        expect(normalizeBlocklist(undefined)).toEqual({entries: [], warnings: []});
    });

    it("틀린 항목은 건너뛰고 경고를 남기며 나머지는 정규화해 둔다", () => {
        const result = normalizeBlocklist([
            {address: "198.51.100.9/24", port: null, note: "a", createdAt: 5, createdBy: "admin"},
            {address: "bogus", port: null, note: "", createdAt: 1, createdBy: "admin"},
            "not-an-object",
            {address: "203.0.113.7", port: 70000, note: "", createdAt: 1, createdBy: "admin"},
            {address: "198.51.100.0/24", port: 1111, note: "dup", createdAt: 6, createdBy: "admin"},
            {address: "203.0.113.8"}
        ]);
        expect(result.entries).toEqual([
            {address: "198.51.100.0/24", port: null, note: "a", createdAt: 5, createdBy: "admin"},
            {address: "203.0.113.8", port: null, note: "", createdAt: 0, createdBy: ""}
        ]);
        expect(result.warnings).toHaveLength(4);
        expect(result.warnings[0]).toContain("connectionSecurity.blocklist[1]");
        // 정규화된 목록만 남으므로 다음 저장 때 파일에서도 빠진다. 경고가 그 사실을 알린다.
        expect(result.warnings.every((warning) => warning.endsWith("dropped at the next save"))).toBe(true);
    });

    it("상한보다 긴 메모는 잘라 두고 경고한다", () => {
        const result = normalizeBlocklist([{address: "203.0.113.7", note: "x".repeat(MAX_BLOCKLIST_NOTE_LENGTH + 5)}]);
        expect(result.entries[0].note).toHaveLength(MAX_BLOCKLIST_NOTE_LENGTH);
        expect(result.warnings).toEqual([`connectionSecurity.blocklist[0]: note is longer than ${MAX_BLOCKLIST_NOTE_LENGTH} characters; truncated`]);
    });

    it("배열이 아니면 빈 목록과 경고다", () => {
        expect(normalizeBlocklist("x")).toEqual({entries: [], warnings: ["connectionSecurity.blocklist must be an array; ignored and dropped at the next save"]});
    });

    it("상한을 넘는 항목은 버리고 경고한다", () => {
        const raw = Array.from({length: MAX_BLOCKLIST_ENTRIES + 2}, (_, i) => entryOf(`10.0.${Math.floor(i / 256)}.${i % 256}`));
        const result = normalizeBlocklist(raw);
        expect(result.entries).toHaveLength(MAX_BLOCKLIST_ENTRIES);
        expect(result.warnings).toEqual([`connectionSecurity.blocklist has more than ${MAX_BLOCKLIST_ENTRIES} entries; 2 ignored and dropped at the next save`]);
    });
});
