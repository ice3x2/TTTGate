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
