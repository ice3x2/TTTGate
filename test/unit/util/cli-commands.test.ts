import CLI from "../../../src/util/CLI";

// #215 클라이언트 하위 명령, #214 join 인자
describe("client commands", () => {
    test("REQ-1 run, join <addr>, config show and config save are recognised", () => {
        expect(CLI.parseCommandLine(["client", "run", "-addr", "gw"])).toMatchObject({mode: "client", command: ["run"], errors: []});
        expect(CLI.parseCommandLine(["client", "join", "gw:9126", "--code", "7Q4K-M2XP-AB01"]))
            .toMatchObject({mode: "client", command: ["join"], positionals: ["gw:9126"], options: {code: "7Q4K-M2XP-AB01"}, errors: []});
        expect(CLI.parseCommandLine(["client", "config", "show", "-addr", "gw"])).toMatchObject({command: ["config", "show"], errors: []});
        expect(CLI.parseCommandLine(["client", "config", "save", "-addr", "gw"])).toMatchObject({command: ["config", "save"], errors: []});
    });

    test("REQ-2 no command keeps working as run", () => {
        expect(CLI.parseCommandLine(["client", "-addr", "gw", "-save"])).toMatchObject({command: [], errors: []});
    });

    test("REQ-4 options are checked per command", () => {
        expect(CLI.parseCommandLine(["client", "join", "gw", "--code", "x", "-daemon"]).errors)
            .toEqual([expect.stringContaining("-daemon")]);
        expect(CLI.parseCommandLine(["client", "join", "gw", "--code", "x", "-addr", "gw"]).errors)
            .toEqual([expect.stringContaining("-addr")]);
        expect(CLI.parseCommandLine(["client", "run", "--code", "x"]).errors).toEqual([expect.stringContaining("--code")]);
        expect(CLI.parseCommandLine(["client", "config", "show", "-daemon"]).errors).toEqual([expect.stringContaining("-daemon")]);
        expect(CLI.parseCommandLine(["client", "join", "gw", "--code", "x", "--force"]).errors).toEqual([]);
    });

    test("REQ-4 a missing join address, an unknown command and extra words are errors", () => {
        expect(CLI.parseCommandLine(["client", "join", "--code", "x"]).errors).toEqual([expect.stringContaining("<addr>")]);
        expect(CLI.parseCommandLine(["client", "config"]).errors).toEqual([expect.stringContaining("'config'")]);
        expect(CLI.parseCommandLine(["client", "config", "edit"]).errors.length).toBeGreaterThan(0);
        expect(CLI.parseCommandLine(["client", "join", "gw", "extra", "--code", "x"]).errors).toEqual([expect.stringContaining("'extra'")]);
    });

    test("the option value after join is not mistaken for the command", () => {
        expect(CLI.parseCommandLine(["client", "-name", "join", "-addr", "gw"])).toMatchObject({command: [], options: {name: "join"}, errors: []});
    });
});
