import CLI from "../../../src/util/CLI";

describe("CLI.parseCommandLine", () => {
    it("detects the execution mode even when options come first", () => {
        const parsed = CLI.parseCommandLine(["-daemon", "client", "-addr", "localhost:9126"]);

        expect(parsed.mode).toBe("client");
        expect(parsed.options).toMatchObject({
            daemon: "",
            addr: "localhost:9126"
        });
    });

    it("keeps server options stable regardless of positional order", () => {
        const parsed = CLI.parseCommandLine(["-keepAlive", "45000", "server", "-reset", "false"]);

        expect(parsed.mode).toBe("server");
        expect(parsed.options).toMatchObject({
            keepAlive: "45000",
            reset: "false"
        });
    });
});
