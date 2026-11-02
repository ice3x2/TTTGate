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
    it.each([
        ["English", () => english, {wrong: "`0.0.0.0`, `::` and host names do not work", refused: /connection refused/i, timeout: /time(s|d)? out/i,
            noReset: /do not use `-reset`/i, lastSuperuser: /last (active )?superuser/i, staysUntilSetup: /token stays the same/i}],
        ["한국어", () => korean, {wrong: "`0.0.0.0`, `::`, 호스트 이름은 쓸 수 없다", refused: /연결 거부/, timeout: /시간 초과/,
            noReset: /`-reset` 은 쓰지 않는다/, lastSuperuser: /마지막 (활성 )?슈퍼유저/, staysUntilSetup: /토큰이 바뀌지 않는다/}],
    ] as const)("explains remote console access, the bootstrap token and account recovery in the %s section", (_label, section, words) => {
        const text = section();
        expect(text).not.toContain(words.wrong);
        for(const fact of ["adminBindHost: 0.0.0.0", "\"https://192.0.2.10:9300\"", "./TTTGate-linux-x64 server -daemon -allowLegacyAdminRemote",
            "./TTTGate-linux-x64 stop", "Azure", "AWS", "OCI", "403 Forbidden origin", "Refusing insecure admin policy",
            "~/TTTGate/config/.bootstrap-token", "ssh user@server.example.com 'cat ~/TTTGate/config/.bootstrap-token'",
            "**My account**", "**Change password**", "**Reset password**", "**Reset MFA**", "config/identity.yaml", "config/.key"]) {
            expect({fact, found: text.includes(fact)}).toEqual({fact, found: true});
        }
        for(const pattern of [words.refused, words.timeout, words.noReset, words.lastSuperuser, words.staysUntilSetup]) expect(text).toMatch(pattern);
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
