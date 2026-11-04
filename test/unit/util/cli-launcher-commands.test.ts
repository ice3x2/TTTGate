import CLI from "../../../src/util/CLI";
import {renderHelp} from "../../../src/util/CliHelp";

// #322 런처가 쓰는 명령: status --json(REQ-13), client join --json(REQ-16), server config save(REQ-17)
describe("launcher commands", () => {
    test("REQ-13 status is a mode and takes --json", () => {
        expect(CLI.parseCommandLine(["status", "--json"])).toMatchObject({mode: "status", command: [], options: {json: ""}, errors: []});
        expect(CLI.parseCommandLine(["status"])).toMatchObject({mode: "status", errors: []});
        expect(CLI.parseCommandLine(["status", "-daemon"]).errors.length).toBeGreaterThan(0);
        expect(CLI.parseCommandLine(["status", "-adminPort", "1"]).errors.length).toBeGreaterThan(0);
    });

    test("REQ-16 --json is accepted by client join only", () => {
        expect(CLI.parseCommandLine(["client", "join", "gw", "--code", "x", "--json"]).errors).toEqual([]);
        expect(CLI.parseCommandLine(["client", "run", "-addr", "gw", "--json"]).errors).toEqual([expect.stringContaining("--json")]);
        expect(CLI.parseCommandLine(["server", "--json"]).errors).toEqual([expect.stringContaining("--json")]);
    });

    test("REQ-17 server config save takes the launcher options", () => {
        const parsed = CLI.parseCommandLine(["server", "config", "save", "-adminPort", "9300", "-adminBindHost", "0.0.0.0",
            "-adminAllowedOrigins", "https://gw.example:9300,https://a.example", "-controlPort", "9126", "-controlTls", "true",
            "-controlProtocolMode", "mixed", "-allowLegacyAdminRemote"]);
        expect(parsed).toMatchObject({mode: "server", command: ["config", "save"], errors: [], options: {
            adminPort: "9300", adminBindHost: "0.0.0.0", adminAllowedOrigins: "https://gw.example:9300,https://a.example",
            controlPort: "9126", controlTls: "true", controlProtocolMode: "mixed", allowLegacyAdminRemote: ""}});
    });

    test("REQ-17 the save-only options are refused when the server runs, and -daemon is refused by config save", () => {
        expect(CLI.parseCommandLine(["server", "-adminBindHost", "0.0.0.0"]).errors).toEqual([expect.stringContaining("-adminBindHost")]);
        expect(CLI.parseCommandLine(["server", "-controlPort", "9126"]).errors).toEqual([expect.stringContaining("-controlPort")]);
        expect(CLI.parseCommandLine(["server", "config", "save", "-daemon"]).errors).toEqual([expect.stringContaining("-daemon")]);
        expect(CLI.parseCommandLine(["server", "config", "show"]).errors.length).toBeGreaterThan(0);
    });

    test("existing server runs keep working", () => {
        expect(CLI.parseCommandLine(["server", "-daemon", "-allowLegacyAdminRemote"])).toMatchObject({mode: "server", command: [], errors: []});
        expect(CLI.parseCommandLine(["server", "-adminPort", "9300"])).toMatchObject({errors: []});
    });

    test("the help lists status and server config save with their options", () => {
        const top = renderHelp("none", false);
        expect(top).toContain("Usage: TTTGate <server|client|stop|status> [options]");
        expect(top).toMatch(/\n  status +\S/);
        expect(renderHelp("status", false)).toContain("-json ");
        const server = renderHelp("server", false);
        expect(server).toContain("Usage: TTTGate server [command] [options]");
        expect(server).toMatch(/config save +Save .*server\.yaml/);
        for(const name of ["-adminBindHost", "-adminAllowedOrigins", "-controlPort", "-controlTls", "-controlProtocolMode"]) {
            expect(server).toContain(name);
        }
        expect(renderHelp("client", false)).toMatch(/config save +Save .*client\.yaml/);
    });
});
