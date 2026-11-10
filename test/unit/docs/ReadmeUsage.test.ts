import fs from "fs";
import Path from "path";
import {CLI_OPTIONS} from "../../../src/util/CliSpec";
import {COMMANDS} from "../../../src/util/CLI";

// #302 — README 는 모든 CLI 옵션, 웹 관리 화면 접속 방법, 최초 관리자 설정 절차를 적는다.
// 옵션의 기준은 CliSpec 의 정의 표다. 옵션을 더하고 README 를 고치지 않으면 이 테스트가 실패한다.
// Windows 체크아웃은 CRLF 다. 줄 단위로 찾는 검사가 같은 결과를 내도록 LF 로 맞춘다.
const readme = fs.readFileSync(Path.join(process.cwd(), "README.md"), {encoding: "utf-8"}).replace(/\r\n/g, "\n");

/** CLI 는 앞의 대시 개수를 가리지 않는다(-name, --name). 글에 둘 중 하나가 단어 경계와 함께 있으면 적힌 것으로 본다. */
const mentions = (name: string, text = readme): boolean =>
    new RegExp(`(?<![\\w-])--?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(text);

const documentedModes = ["server", "client"] as const;
const userFacingOptions = CLI_OPTIONS.filter((def) => def.group !== "help" && !def.hidden && !def.aliasOf
    && def.modes.some((mode) => (documentedModes as readonly string[]).includes(mode)));

describe("README usage documentation (#302)", () => {
    it("lists every user-facing server and client option", () => {
        expect(userFacingOptions.length).toBeGreaterThan(0);
        expect(userFacingOptions.map((def) => def.name).filter((name) => !mentions(name))).toEqual([]);
    });

    it("explains how to open the admin web console", () => {
        expect(readme).toContain("## Admin Web Console");
        expect(readme).toContain("https://127.0.0.1:9300/");
        for(const key of ["adminPort", "adminBindHost", "adminTls"]) expect(readme).toContain(`\`${key}\``);
        expect(readme).toContain("Testing CA - DO NOT TRUST");
        expect(readme).toContain("ssh -L 9300:127.0.0.1:9300");
    });

    // #303 — 역방향 프록시·도메인으로 여는 방법(허용 Origin, 프록시 설정 예, 적용 시점)을 적는다.
    it("explains how to open the console through a reverse proxy", () => {
        expect(readme).toContain("`adminAllowedOrigins`");
        expect(readme).toContain("proxy_pass https://127.0.0.1:9300;");
        expect(readme).toMatch(/restart the server after you edit `server\.yaml`/i);
        expect(readme).not.toContain("is not supported at this time");
        // 국가 필터는 소켓 주소(프록시·SSH 터널이면 127.0.0.1)로 판정한다. 국가 제한은 프록시에서 걸어야 한다.
        expect(readme).toMatch(/country filter[^\n]*(proxy|tunnel)/i);
    });

    it("explains the first admin setup with the bootstrap token", () => {
        expect(readme).toContain("config/.bootstrap-token");
        expect(readme).toContain("**Bootstrap token**");
        expect(readme).toMatch(/at least 8 characters/);
    });
});

// #310 — 맨 위에 언어 바로가기를 두고, 영어 절(## English) 다음에 같은 구조의 한국어 절(## 한국어)을 둔다.
// 두 절은 각각 모든 사용자 옵션과 핵심 사실을 담는다. 한쪽만 고치면 이 테스트가 실패한다.
describe("README in English and Korean (#310)", () => {
    const englishStart = readme.indexOf("\n## English\n");
    const koreanStart = readme.indexOf("\n## 한국어\n");
    const english = readme.slice(englishStart, koreanStart);
    const korean = readme.slice(koreanStart);
    const subheadings = (text: string) => text.split("\n").filter((line) => /^###\s/.test(line));

    it("links to both languages right below the title and puts English first", () => {
        const top = readme.split("\n").slice(0, 10).join("\n");
        expect(top).toContain("](#english)");
        expect(top).toContain("](#한국어)");
        expect(englishStart).toBeGreaterThan(0);
        expect(koreanStart).toBeGreaterThan(englishStart);
    });

    it("gives both languages the same structure and a table of contents", () => {
        expect(subheadings(english).length).toBeGreaterThan(5);
        expect(subheadings(korean).length).toBe(subheadings(english).length);
        expect(english).toMatch(/### Contents/);
        expect(korean).toMatch(/### 목차/);
    });

    it.each([["English", () => english], ["한국어", () => korean]])("keeps every option and key fact in the %s section", (_label, section) => {
        const text = section();
        expect(userFacingOptions.map((def) => def.name).filter((name) => !mentions(name, text))).toEqual([]);
        for(const fact of ["https://127.0.0.1:9300/", "config/.bootstrap-token", "`adminAllowedOrigins`", "ssh -L 9300:127.0.0.1:9300",
            "proxy_pass https://127.0.0.1:9300;", "Testing CA - DO NOT TRUST", "`logLevel`", "`closeStallMs`", "`closeGraceMs`",
            "client join", "TTTGATE_CLIENT_SECRET", "-allowLegacyAdminRemote"]) {
            expect({fact, found: text.includes(fact)}).toEqual({fact, found: true});
        }
    });

    // 사용자 요청(2026-11-01): CLI 사용 방법을 철저히 적는다. 명령줄 레퍼런스 절의 표에 모든 옵션과 명령이 한 행씩 있다.
    const referenceOf = (section: string, heading: string): string => {
        const start = section.indexOf(`\n### ${heading}\n`);
        if(start < 0) return "";
        const next = section.indexOf("\n### ", start + 1);
        return section.slice(start, next < 0 ? undefined : next);
    };
    const tableRows = (text: string) => text.split("\n").filter((line) => line.startsWith("|"));
    const commandLines = ["server", "client", "stop", ...Object.entries(COMMANDS).flatMap(([mode, list]) => list.map((command) => `${mode} ${command.path.join(" ")}`))];

    // #313: 등록 코드의 만료는 화면에서 고르고(최대 30일), 만료 없음도 줄 수 있다. 두 절 모두 적는다.
    it.each([["English", () => english], ["한국어", () => korean]])("explains the enrollment code expiry choices in the %s section", (_label, section) => {
        const text = section();
        for(const fact of ["**Code expires after**", "**Never expires**"]) expect({fact, found: text.includes(fact)}).toEqual({fact, found: true});
        expect(text).toMatch(/30 days|30일/);
        expect(text).toMatch(/`ttlMinutes`[^\n]*(43200|1–43200)/);
        expect(text).not.toMatch(/1–1440/);
        // 관리 화면의 두 단계 발급: 임시로 받고 보여 줄 때 확인한다. 확인하지 않으면 15분 뒤 사라진다.
        expect(text).toMatch(/`provisional: true`/);
        expect(text).toMatch(/`POST \/api\/trustedClients\/<id>\/enrollmentCode\/confirm`/);
        // 비밀값 교체(New secret)도 코드를 무효로 한다.
        expect(text).toMatch(/\*\*Never expires\*\*[^\n]*(new secret|비밀값)/i);
    });

    // #316: 관리 화면을 다른 컴퓨터에서 여는 방법, 원격 서버의 부트스트랩 토큰, 관리자 계정 복구를 두 절 모두 적는다.
    // #303 뒤로 0.0.0.0 바인드는 adminAllowedOrigins 와 함께 동작한다. 예전의 "쓸 수 없다" 문장은 틀렸다.
    // 다른 절에 이미 있는 글귀로는 회귀를 잡지 못하므로, 새로 쓴 소절(방법 2, 증상 표, 첫 로그인, 계정 복구)을 잘라 그 안에서 찾는다.
    const subsectionOf = (section: string, heading: string): string => {
        const start = section.indexOf(`\n#### ${heading}\n`);
        if(start < 0) return "";
        const next = section.slice(start + 1).search(/\n#{2,4} /);
        return next < 0 ? section.slice(start) : section.slice(start, start + 1 + next);
    };
    const between = (text: string, from: string, to: string): string => {
        const start = text.indexOf(from);
        if(start < 0) return "";
        const end = text.indexOf(to, start + from.length);
        return end < 0 ? "" : text.slice(start, end);
    };
    type Expectation = {heading: string; contains: string[]; matches: RegExp[]; absent: string[]; before?: Array<[string, string]>};
    const remoteAccessFacts: Array<[string, () => string, {wrong: string; method2: [string, string, string]; parts: Expectation[]}]> = [
        ["English", () => english, {
            wrong: "`0.0.0.0`, `::` and host names do not work",
            method2: ["Open the Console from Another Computer", "2. **Expose the console port directly", "\n3. **"],
            parts: [
                {heading: "Open the Console", contains: ["`127.0.0.1`, `localhost`, `[::1]`, or an IP address (IPv4 or IPv6) or a host name in `adminBindHost` (not `0.0.0.0` or `::`)", "for example `https://[::1]:9300`"], matches: [], absent: ["`127.0.0.1`, `::1`, `localhost` or the `adminBindHost`", "This includes IPv6 addresses.", "add `\"https://[::1]:9300\"` to `adminAllowedOrigins`"]},
                {heading: "method 2", contains: ["adminBindHost: 0.0.0.0", "\"https://192.0.2.10:9300\"", "cd ~/TTTGate/bin",
                    "./TTTGate-linux-x64 server -daemon -allowLegacyAdminRemote", "./TTTGate-linux-x64 stop", "network security group", "the security group (AWS)", "Allow only the source addresses", "security list", "`server configuration is not ready`",
                    "one IP address (IPv4 or IPv6) or one host name of the server", "`https://[fd00::10]:9300`", "Only `127.0.0.1`, `localhost` and `[::1]` with the console port"], matches: [/flag is not saved/], absent: ["With `-daemon`, the reason is in `logs/`.", "or an IPv6 address, still need an entry"]},
                {heading: "If the Console Does Not Open", contains: ["| Symptom | Cause | What to do |", "connection refused", "times out",
                    "`403 Forbidden origin`", "`Refusing insecure admin policy: ...`", "`[::1]`, or an IP address or a host name in `adminBindHost`", "`server configuration is not ready`"],
                    matches: [/certificate warning[^\n]*outside the server host[^\n]*your own certificate/], absent: []},
                {heading: "First Admin Login", contains: ["cat ../config/.bootstrap-token", "~/TTTGate/config/.bootstrap-token",
                    "ssh user@server.example.com 'cat ~/TTTGate/config/.bootstrap-token'", "sudo cat"], matches: [/A restart that reuses the token does not write this line again/], absent: []},
                {heading: "Recover Admin Accounts", contains: ["**My account**", "**Change password**", "**Reset password**", "**Reset MFA**",
                    "~/identity.yaml.$(date +%Y%m%d%H%M%S).bak", "rm ~/TTTGate/config/identity.yaml", "rm -f ~/TTTGate/config/.key",
                    "The file contains password hashes and two-factor secrets.", "delete it when you no longer need it",
                    "Replace `~/TTTGate` with your installation folder", "systemd", "**Two-factor authentication**", "**Disable**", "**Set up**", "**Replace app**", "**Disable** stays off", "If no recovery code is left", "**Use a recovery code instead**",
                    "`/opt/TTTGate/config/identity.yaml`", "only administrators can read",
                    "If no other superuser can sign in either, follow case 3.",
                    "This also ends the sessions of that user.", "**No superuser can sign in (the password is forgotten, or two-factor authentication is lost and no recovery code is left).**"],
                    before: ["All users, groups and two-factor settings are lost.", "Delete `config/.key` too.", "Do not use `-reset` for this."]
                        .map((warning): [string, string] => [warning, "\n   1. Stop the server"]),
                    matches: [/creates the `admin` account with the old password/, /do not use `-reset`/i, /last active superuser/,
                        /`No such file or directory`[^\n]*the folder is wrong/, /All users, groups and two-factor settings are lost/, /tunnel owner refers to a user that no longer exists/], absent: []},
                {heading: "Configuration Files", contains: ["When `config/identity.yaml` does not exist, the server creates the `admin` account"],
                    matches: [], absent: []},
            ]}],
        ["한국어", () => korean, {
            wrong: "`0.0.0.0`, `::`, 호스트 이름은 쓸 수 없다",
            method2: ["다른 컴퓨터에서 관리 화면 열기", "2. **관리 화면 포트를 직접 열기", "\n3. **"],
            parts: [
                {heading: "관리 화면 열기", contains: ["`127.0.0.1`, `localhost`, `[::1]` 또는 `adminBindHost` 에 적은 IP 주소(IPv4·IPv6)나 호스트 이름(`0.0.0.0`, `::` 제외)", "예: `https://[::1]:9300`"], matches: [], absent: ["`127.0.0.1`, `::1`, `localhost` 또는 `adminBindHost`", "IPv6 주소도 마찬가지다.", "`adminAllowedOrigins` 에 `\"https://[::1]:9300\"` 을 넣는다"]},
                {heading: "method 2", contains: ["adminBindHost: 0.0.0.0", "\"https://192.0.2.10:9300\"", "cd ~/TTTGate/bin",
                    "./TTTGate-linux-x64 server -daemon -allowLegacyAdminRemote", "./TTTGate-linux-x64 stop", "네트워크 보안 그룹", "AWS 는 보안 그룹", "보안 목록", "`server configuration is not ready`",
                    "서버의 IP 주소(IPv4·IPv6)나 호스트 이름 하나", "`https://[fd00::10]:9300`", "관리 화면 포트를 쓰는 `127.0.0.1`, `localhost`, `[::1]` 뿐이다",
                    "`0.0.0.0`(모든 IPv4 주소)와 `::`(모든 주소)는", "접속하는 쪽 주소"], matches: [/플래그는 저장되지 않/], absent: ["`-daemon` 으로 시작했다면 그 이유는 `logs/` 에 남는다.", "원본 주소", "IPv6 주소처럼 다른 주소로 열려면"]},
                {heading: "관리 화면이 열리지 않을 때", contains: ["| 증상 | 원인 | 조치 |", "연결 거부", "시간 초과",
                    "`403 Forbidden origin`", "`Refusing insecure admin policy: ...`", "`[::1]`, `adminBindHost` 에 적은 IP 주소나 호스트 이름", "`server configuration is not ready`"],
                    matches: [/인증서 경고[^\n]*서버 호스트 밖[^\n]*직접 준비한 인증서/], absent: []},
                {heading: "첫 관리자 로그인", contains: ["cat ../config/.bootstrap-token", "~/TTTGate/config/.bootstrap-token",
                    "ssh user@server.example.com 'cat ~/TTTGate/config/.bootstrap-token'", "sudo cat"], matches: [/기존 토큰을 다시 쓰는 재시작에서는 이 줄을 다시 남기지 않는다/], absent: []},
                {heading: "관리자 계정 복구", contains: ["**My account**", "**Change password**", "**Reset password**", "**Reset MFA**",
                    "~/identity.yaml.$(date +%Y%m%d%H%M%S).bak", "rm ~/TTTGate/config/identity.yaml", "rm -f ~/TTTGate/config/.key",
                    "이 파일에는 비밀번호 해시와 2단계 인증 비밀값이 들어 있다", "더 필요 없으면 지운다",
                    "`~/TTTGate` 는 실제 설치 폴더로 바꾼다", "systemd", "**Two-factor authentication**", "**Disable**", "**Set up**", "**Replace app**", "**Disable** 은 꺼져 있다", "남은 복구 코드가 없으면", "**Use a recovery code instead**",
                    "`/opt/TTTGate/config/identity.yaml`", "관리자만 읽을 수 있는",
                    "로그인할 수 있는 다른 슈퍼유저도 없으면 3번 경우를 따른다.",
                    "이때도 그 사용자의 세션이 모두 끊긴다.", "**로그인할 수 있는 슈퍼유저가 없다(비밀번호를 잊었거나, 2단계 인증을 잃었고 남은 복구 코드도 없다).**",
                    "로그인 중 2단계 인증 화면에서"],
                    before: ["모든 사용자, 그룹, 2단계 인증 설정이 사라진다.", "`config/.key` 도 반드시 지운다.", "이 작업에 `-reset` 은 쓰지 않는다."]
                        .map((warning): [string, string] => [warning, "\n   1. 서버를 멈춘다"]),
                    matches: [/`No such file or directory`[^\n]*폴더가 틀린 것이다/, /모든 사용자, 그룹, 2단계 인증 설정이 사라진다/, /터널 소유자가 더는 없는 사용자를 가리킨다/, /`\.key` 의 예전 비밀번호로 `admin` 계정을 다시 만든다/, /`-reset` 은 쓰지 않는다/, /마지막 활성 슈퍼유저/], absent: []},
                {heading: "설정 파일", contains: ["`config/identity.yaml` 이 없으면 `.key` 로 `admin` 계정을 만든다"], matches: [], absent: []},
            ]}],
    ];
    it.each(remoteAccessFacts)("explains remote console access, the bootstrap token and account recovery in the %s section", (_label, section, facts) => {
        const text = section();
        expect(text).not.toContain(facts.wrong);
        const [method2Heading, method2Start, method2End] = facts.method2;
        for(const part of facts.parts) {
            const slice = part.heading === "method 2" ? between(subsectionOf(text, method2Heading), method2Start, method2End)
                : part.heading === "Configuration Files" || part.heading === "설정 파일" ? between(text, `\n### ${part.heading}\n`, "\n### ")
                : subsectionOf(text, part.heading);
            expect({part: part.heading, sliced: slice.length > 0}).toEqual({part: part.heading, sliced: true});
            for(const fact of part.contains) expect({part: part.heading, fact, found: slice.includes(fact)}).toEqual({part: part.heading, fact, found: true});
            for(const pattern of part.matches) expect({part: part.heading, pattern: String(pattern), found: pattern.test(slice)}).toEqual({part: part.heading, pattern: String(pattern), found: true});
            for(const fact of part.absent) expect({part: part.heading, fact, found: slice.includes(fact)}).toEqual({part: part.heading, fact, found: false});
            // 경고는 절차보다 먼저 읽어야 한다.
            for(const pair of part.before ?? []) {
                const [first, then] = pair.map((needle) => slice.indexOf(needle));
                expect({part: part.heading, order: pair, ok: first >= 0 && then >= 0 && first < then}).toEqual({part: part.heading, order: pair, ok: true});
            }
        }
    });

    // 이슈 348 §6: 켠 사람의 IP 만 받는 설정의 기본값·업그레이드·운영 주의를 두 절 모두 그 소절 안에 적는다.
    it.each([["English", "Limit a Tunnel to the IPs That Turned It On", () => english], ["한국어", "켠 사람의 IP 에서만 연결 받기", () => korean]])(
        "explains the activator IP limit in the %s section", (_label, heading, section) => {
        const slice = subsectionOf(section(), heading);
        expect(slice.length).toBeGreaterThan(0);
        for(const fact of ["`activatorIpOnly`", "`activator-ip`", "`-trustXForwardedFor`", "IPv6", "IPv4", "CDN", "`tunnel_ip_limit_updated`",
            "`tunnel_ip_refreshed`", "`PUT /api/tunneling/<port>/activatorIpOnly`", "`POST /api/tunneling/<port>/activatorIp`", "`userland-proxy`"]) {
            expect({fact, found: slice.includes(fact)}).toEqual({fact, found: true});
        }
    });

    // 이슈 349 FR-11: 관리 화면의 언어 규칙(브라우저 언어 목록의 첫 값이 ko 또는 ko-* 면 한국어, 아니면 영어)을 두 절 모두 적는다.
    it.each([["English", "Console Language", () => english], ["한국어", "관리 화면 언어", () => korean]])(
        "explains how the console picks its language in the %s section", (_label, heading, section) => {
        const slice = subsectionOf(section(), heading);
        expect(slice.length).toBeGreaterThan(0);
        for(const fact of ["`ko`", "`ko-*`", "`navigator.languages`", "`en-US`, `ko-KR`"]) {
            expect({fact, found: slice.includes(fact)}).toEqual({fact, found: true});
        }
        expect(slice).toMatch(/English|영어/);
    });

    it.each([["English", () => english], ["한국어", () => korean]])("lists the activator-ip denial reason in the %s section", (_label, section) => {
        expect(section()).toMatch(/^\| `activator-ip` \| IP limit \|/m);
    });

    it.each([["English", "Command-Line Reference", () => english], ["한국어", "명령줄 레퍼런스", () => korean]])(
        "documents every option and command as its own table row in the %s CLI reference", (_label, heading, section) => {
        const reference = referenceOf(section(), heading);
        expect(reference.length).toBeGreaterThan(0);
        const rows = tableRows(reference);
        const missingOptions = userFacingOptions.map((def) => def.name)
            .filter((name) => !rows.some((row) => new RegExp(`^\\|\\s*\`--?${name}(?![\\w-])`).test(row)));
        expect(missingOptions).toEqual([]);
        const missingCommands = commandLines.filter((command) => !rows.some((row) => row.includes(`\`${command}`)));
        expect(missingCommands).toEqual([]);
    });
});
