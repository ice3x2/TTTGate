import CLI from "../../../src/util/CLI";
import {CLI_OPTIONS, findCliOption} from "../../../src/util/CliSpec";

// #203 — '-' 로 시작하는 값, 플래그 뒤 진릿값, 위치 인자
describe("CLI.parseCommandLine values (#203)", () => {
    test("REQ-1 inline value may start with '-'", () => {
        const parsed = CLI.parseCommandLine(["client", "-clientSecret=-abc"]);
        expect(parsed.errors).toEqual([]);
        expect(parsed.options.clientSecret).toBe("-abc");
    });

    test("REQ-2 the token after a value option is its value even when it starts with '-'", () => {
        const parsed = CLI.parseCommandLine(["client", "-clientSecret", "-abc", "-bufferLimit", "-1"]);
        expect(parsed.errors).toEqual([]);
        expect(parsed.options).toEqual({clientSecret: "-abc", bufferLimit: "-1"});
    });

    test("REQ-3 a flag takes a following boolean word and nothing else", () => {
        expect(CLI.parseCommandLine(["client", "-tls", "-name", "x"]).options).toEqual({tls: "", name: "x"});
        expect(CLI.parseCommandLine(["client", "-tls", "false"]).options).toEqual({tls: "false"});
        expect(CLI.parseCommandLine(["client", "-save", "OFF"]).options).toEqual({save: "OFF"});
        expect(CLI.parseCommandLine(["server", "-reset", "false"]).options).toEqual({reset: "false"});
    });

    test("REQ-4 a value option without a value is an error", () => {
        const parsed = CLI.parseCommandLine(["client", "-clientSecret"]);
        expect(parsed.errors).toEqual([expect.stringContaining("-clientSecret")]);
    });

    test("REQ-5 a token in a value position is never the mode", () => {
        const parsed = CLI.parseCommandLine(["-name", "server", "client"]);
        expect(parsed.errors).toEqual([]);
        expect(parsed.mode).toBe("client");
        expect(parsed.options.name).toBe("server");
    });

    test("REQ-6 a leftover positional argument is an error", () => {
        const parsed = CLI.parseCommandLine(["client", "-name", "a", "b"]);
        expect(parsed.errors).toEqual([expect.stringContaining("'b'")]);
    });
});

// #204 — 정의 표, 모르는 옵션, -daemon·-dev
describe("CLI.parseCommandLine strict options (#204)", () => {
    test("REQ-1 every option the code reads is in the table", () => {
        const names = CLI_OPTIONS.map(def => def.name);
        for(const name of ["daemon", "dev", "adminPort", "keepAlive", "allowLegacyAdminHttp", "allowLegacyAdminRemote",
            "trustXForwardedFor", "trustedProxyHops", "allowLegacyControlAuth", "requireCsrfHeader", "reset",
            "addr", "tls", "name", "clientId", "clientSecret", "displayName", "key", "ca", "cert", "privateKey",
            "serverName", "allowLegacyFallback", "allowInsecureTls", "bufferLimit", "save", "yes-insecure", "yesInsecure",
            "h", "help", "help-advanced", "version"]) {
            expect(names).toContain(name);
        }
        expect(findCliOption("yesInsecure")?.aliasOf).toBe("yes-insecure");
    });

    test("REQ-2 an unknown option is an error that suggests the closest name", () => {
        const parsed = CLI.parseCommandLine(["client", "-adr", "x.com"]);
        expect(parsed.errors).toEqual([expect.stringMatching(/unknown option '-adr'.*-addr/)]);
    });

    test("REQ-2 an option that the mode does not allow is an error", () => {
        expect(CLI.parseCommandLine(["client", "-adminPort", "9300"]).errors).toEqual([expect.stringContaining("-adminPort")]);
        expect(CLI.parseCommandLine(["server", "-addr", "x"]).errors).toEqual([expect.stringContaining("-addr")]);
    });

    test("REQ-3 a case-only difference is an error that names the right option", () => {
        const parsed = CLI.parseCommandLine(["client", "-clientid", "a"]);
        expect(parsed.errors).toEqual([expect.stringMatching(/unknown option '-clientid'.*-clientId/)]);
    });

    test("REQ-4 -daemon and -dev accept only the bare form", () => {
        expect(CLI.parseCommandLine(["client", "-daemon", "-dev"]).errors).toEqual([]);
        expect(CLI.parseCommandLine(["client", "--daemon"]).errors).toEqual([expect.stringContaining("-daemon")]);
        expect(CLI.parseCommandLine(["client", "-daemon=true"]).errors).toEqual([expect.stringContaining("-daemon")]);
        expect(CLI.parseCommandLine(["client", "-daemon", "false"]).errors.length).toBe(1);
        expect(CLI.parseCommandLine(["server", "-dev=1"]).errors).toEqual([expect.stringContaining("-dev")]);
    });

    test("REQ-6 no mode with no options is fine, an unknown mode or options without a mode is an error", () => {
        expect(CLI.parseCommandLine([]).errors).toEqual([]);
        expect(CLI.parseCommandLine(["clinet"]).errors).toEqual([expect.stringContaining("'clinet'")]);
        expect(CLI.parseCommandLine(["-daemon"]).errors).toEqual([expect.stringContaining("mode")]);
        expect(CLI.parseCommandLine(["--help"]).errors).toEqual([]);
        expect(CLI.parseCommandLine(["-h"]).errors).toEqual([]);
        expect(CLI.parseCommandLine(["--version"]).errors).toEqual([]);
    });

    test("double-dash long names stay accepted for value options and flags", () => {
        const parsed = CLI.parseCommandLine(["client", "--addr", "x.com", "--yes-insecure"]);
        expect(parsed.errors).toEqual([]);
        expect(parsed.options).toEqual({addr: "x.com", "yes-insecure": ""});
    });
});
