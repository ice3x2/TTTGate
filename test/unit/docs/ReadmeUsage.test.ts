import fs from "fs";
import Path from "path";
import {CLI_OPTIONS} from "../../../src/util/CliSpec";

// #302 — README 는 모든 CLI 옵션, 웹 관리 화면 접속 방법, 최초 관리자 설정 절차를 적는다.
// 옵션의 기준은 CliSpec 의 정의 표다. 옵션을 더하고 README 를 고치지 않으면 이 테스트가 실패한다.
const readme = fs.readFileSync(Path.join(process.cwd(), "README.md"), {encoding: "utf-8"});

/** CLI 는 앞의 대시 개수를 가리지 않는다(-name, --name). README 에 둘 중 하나가 단어 경계와 함께 있으면 적힌 것으로 본다. */
const mentions = (name: string): boolean =>
    new RegExp(`(?<![\\w-])--?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(readme);

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
