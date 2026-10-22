import Environment from "../Environment";
import {CLI_OPTIONS, CliGroup, CliMode, CliOptionDef} from "./CliSpec";
import {COMMANDS} from "./CLI";

/**
 * 도움말 문구(#208). 옵션 목록은 정의 표(CliSpec)에서 만든다. 옵션을 바꿀 때 이 파일은 고치지 않는다.
 */
const GROUP_TITLES: {[mode: string]: Array<[CliGroup, string]>} = {
    client: [["connection", "Connection"], ["identity", "Identity"], ["tls", "TLS trust"], ["run", "Run"], ["tuning", "Tuning"]],
    server: [["admin", "Admin"], ["proxy", "Proxy"], ["identity", "Identity"], ["run", "Run"], ["tuning", "Tuning"]],
    stop: []
};

const MODE_SUMMARY: Array<[string, string]> = [
    ["server", "Start the tunnel server and the admin console"],
    ["client", "Start a tunnel client"],
    ["stop", "Stop a server or client started with -daemon"]
];

const COMMAND_SUMMARY: {[path: string]: string} = {
    "run": "Start the client (the same as no command)",
    "join": "Enroll this client with a code from the admin console and write config/client.yaml",
    "config show": "Print the resolved options and where each value comes from",
    "config save": "Save the resolved options to config/client.yaml without connecting"
};

const HELP_FOOTER = [
    "  -h, --help         Show help",
    "  --help-advanced    Show help with legacy and risky options",
    "  --version          Print the version"
];

const optionLabel = (def: CliOptionDef): string => {
    const dash = def.name.includes("-") ? "--" : "-";
    return `${dash}${def.name}` + (def.kind === "flag" ? "" : ` <${def.valueName ?? "value"}>`);
};

const aliasesOf = (def: CliOptionDef): CliOptionDef[] => CLI_OPTIONS.filter(other => other.aliasOf === def.name);

const optionLines = (def: CliOptionDef, advanced: boolean): string[] => {
    const label = optionLabel(def);
    const lines = [`  ${label.padEnd(28)} ${def.help}`];
    if(advanced) {
        const aliases = aliasesOf(def).filter(alias => alias.name !== "h");
        if(aliases.length > 0) {
            lines.push(`  ${"".padEnd(28)} alias: ` + aliases.map(alias =>
                `${alias.name.includes("-") ? "--" : "-"}${alias.name}` + (alias.help.startsWith("Deprecated") ? " (deprecated)" : "")).join(", "));
        }
    }
    if(def.risk) lines.push(`  ${"".padEnd(28)} RISK: ${def.risk}`);
    return lines;
};

const visibleOptions = (mode: CliMode): CliOptionDef[] =>
    CLI_OPTIONS.filter(def => def.modes.includes(mode) && !def.hidden && !def.aliasOf && def.group !== "help");

const renderHelp = (mode: CliMode, advanced: boolean): string => {
    if(mode === "none") {
        return [
            "Usage: TTTGate <server|client|stop> [options]",
            "",
            ...MODE_SUMMARY.map(([name, summary]) => `  ${name.padEnd(8)} ${summary}`),
            "",
            "Run 'TTTGate server --help' or 'TTTGate client --help' for the options of each mode.",
            "",
            ...HELP_FOOTER
        ].join("\n");
    }
    const lines: string[] = [`Usage: TTTGate ${mode}` + ((COMMANDS[mode] ?? []).length > 0 ? " [command]" : "") + " [options]"];
    const summary = MODE_SUMMARY.find(([name]) => name === mode);
    if(summary) lines.push("", summary[1]);
    const commands = COMMANDS[mode] ?? [];
    if(commands.length > 0) {
        lines.push("", "Commands:");
        for(const command of commands) {
            const path = command.path.join(" ");
            const usage = path + (command.positionals > 0 ? " <addr>" : "");
            lines.push(`  ${usage.padEnd(28)} ${COMMAND_SUMMARY[path] ?? ""}`);
        }
    }
    const options = visibleOptions(mode);
    for(const [group, title] of GROUP_TITLES[mode] ?? []) {
        const inGroup = options.filter(def => def.group === group && !def.risk);
        if(inGroup.length === 0) continue;
        lines.push("", `${title}:`);
        inGroup.forEach(def => lines.push(...optionLines(def, advanced)));
    }
    if(advanced) {
        const risky = options.filter(def => def.risk);
        if(risky.length > 0) {
            lines.push("", "Legacy and risky options:");
            risky.forEach(def => lines.push(...optionLines(def, advanced)));
        }
    }
    lines.push("", "Help:", ...HELP_FOOTER);
    return lines.join("\n");
};

const renderVersion = (): string => `TTTGate v${Environment.version.name} (${Environment.version.build})`;

export {renderHelp, renderVersion};
