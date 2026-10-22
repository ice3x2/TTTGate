import {CliMode, CliOptionDef, findCliOption, optionAllowedInCommand, suggestCliOption} from "./CliSpec";

type ParsedCommandLine = {
    mode: CliMode;
    /** 모드 다음의 하위 명령 경로(예: client config show). 하위 명령이 없으면 빈 배열이다. */
    command: string[];
    /** 하위 명령이 받는 위치 인자(예: client join <addr>). */
    positionals: string[];
    options: {[key: string]: string};
    /** 명령줄 오류. 하나라도 있으면 실행하지 않고 종료 코드 2 로 끝낸다(#204). */
    errors: string[];
};

const KNOWN_MODES = new Set<CliMode>(["server", "client", "stop"]);
const BOOLEAN_WORD = /^(true|false|1|0|yes|no|on|off)$/i;
/** 모드 없이 쓸 수 있는 옵션. 그 밖의 옵션을 모드 없이 쓰면 오류다(#204 REQ-6). */
const MODELESS_OPTIONS = new Set(["h", "help", "help-advanced", "version"]);

/**
 * 하위 명령 정의(#215). key 는 모드, 값은 하위 명령 경로와 받을 위치 인자 수.
 * 하위 명령이 없는 모드에서 남는 위치 인자는 오류다(#203 REQ-6).
 */
type CliCommandDef = {path: string[], positionals: number, positionalName?: string};
const COMMANDS: {[mode: string]: CliCommandDef[]} = {
    client: [
        {path: ["run"], positionals: 0},
        {path: ["join"], positionals: 1, positionalName: "<addr>"},
        {path: ["config", "show"], positionals: 0},
        {path: ["config", "save"], positionals: 0}
    ]
};

const optionToken = (item: string): boolean => item.startsWith("-") && item.length > 1;

class CLI {
    private static normalizeArgs(argv?: string[]): string[] {
        return argv ?? process.argv.slice(2);
    }

    /** 모드 단어의 위치를 찾는다. 값을 받는 옵션의 값 자리는 건너뛴다(#203 REQ-5). */
    private static findMode(items: string[]): number {
        for(let i = 0; i < items.length; i++) {
            const item = items[i];
            if(item.length === 0) continue;
            if(!optionToken(item)) {
                return KNOWN_MODES.has(item as CliMode) ? i : -1;
            }
            const {def, inlineValue} = CLI.lookup(item);
            if(def && def.kind !== "flag" && inlineValue === undefined) {
                i++;
            } else if(def && def.kind === "flag" && !def.exactToken && inlineValue === undefined
                && i + 1 < items.length && BOOLEAN_WORD.test(items[i + 1])) {
                i++;
            }
        }
        return -1;
    }

    private static lookup(item: string): {name: string, inlineValue?: string, def?: CliOptionDef} {
        const body = item.replace(/^-+/, "");
        const idx = body.indexOf("=");
        const name = idx > 0 ? body.substring(0, idx) : body;
        const inlineValue = idx > 0 ? body.substring(idx + 1) : undefined;
        return {name, inlineValue, def: findCliOption(name)};
    }

    public static parseCommandLine(argv?: string[]): ParsedCommandLine {
        // 빈 토큰(비어 있는 셸 변수)도 자리를 지킨다. 지우면 값 옵션이 다음 옵션을 값으로 삼킨다.
        const items = CLI.normalizeArgs(argv);
        const modeIndex = CLI.findMode(items);
        const mode: CliMode = modeIndex >= 0 ? items[modeIndex] as CliMode : "none";
        const result: ParsedCommandLine = {mode, command: [], positionals: [], options: {}, errors: []};
        const commands = COMMANDS[mode] ?? [];
        const loose: string[] = [];
        const given: Array<{def: CliOptionDef, token: string}> = [];

        for(let i = 0; i < items.length; i++) {
            if(i === modeIndex) continue;
            const item = items[i];
            if(item.length === 0) continue;
            if(!optionToken(item)) {
                loose.push(item);
                continue;
            }
            const {name, inlineValue, def} = CLI.lookup(item);
            if(!def) {
                const suggestion = suggestCliOption(name, mode);
                result.errors.push(`unknown option '${item}'` + (suggestion ? `. Did you mean '-${suggestion}'?` : ""));
                // 모르는 옵션의 값으로 보이는 토큰은 함께 버려서 같은 실수로 오류가 두 번 나지 않게 한다.
                if(inlineValue === undefined && i + 1 < items.length && !optionToken(items[i + 1]) && i + 1 !== modeIndex) i++;
                continue;
            }
            if(def.exactToken && item !== `-${def.name}`) {
                result.errors.push(`option '${item}' must be written as '-${def.name}' without a value`);
                continue;
            }
            if(def.kind === "flag") {
                let value = inlineValue ?? "";
                if(inlineValue === undefined && !def.exactToken && i + 1 < items.length && BOOLEAN_WORD.test(items[i + 1])) {
                    value = items[++i];
                }
                result.options[name] = value;
            } else {
                const value = inlineValue ?? (i + 1 < items.length ? items[++i] : undefined);
                if(value === undefined || value.length === 0) result.errors.push(`option '-${name}' needs a value`);
                else result.options[name] = value;
            }
            given.push({def, token: item.split("=")[0]});
        }

        if(modeIndex < 0 && loose.length > 0) {
            result.errors.push(`unknown mode '${loose[0]}'. Use server, client or stop`);
            return result;
        }
        let rest = loose;
        const matched = commands
            .filter(cmd => cmd.path.every((word, n) => rest[n] === word))
            .sort((a, b) => b.path.length - a.path.length)[0];
        if(matched) {
            result.command = matched.path;
            rest = rest.slice(matched.path.length);
            result.positionals = rest.slice(0, matched.positionals);
            rest = rest.slice(matched.positionals);
        }
        if(matched && result.positionals.length < matched.positionals) {
            result.errors.push(`${mode} ${matched.path.join(" ")} needs ${matched.positionalName ?? "an argument"}`);
        }
        for(const extra of rest) {
            result.errors.push(`unexpected argument '${extra}'`);
        }
        const commandKey = result.command.join(" ");
        for(const {def, token} of given) {
            if(mode === "none" ? !MODELESS_OPTIONS.has(def.name) : !def.modes.includes(mode)) {
                result.errors.push(mode === "none"
                    ? `option '${token}' needs a mode (server, client or stop)`
                    : `option '${token}' is not available in ${mode} mode`);
            } else if(mode !== "none" && !optionAllowedInCommand(def, commandKey)) {
                result.errors.push(`option '${token}' is not available in '${mode}${commandKey ? " " + commandKey : ""}'`);
            }
        }
        return result;
    }
}

export { CLI, CliMode, ParsedCommandLine, COMMANDS, CliCommandDef };
export default CLI;
