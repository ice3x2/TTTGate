type CliMode = "server" | "client" | "stop" | "none";

type ParsedCommandLine = {
    mode: CliMode;
    options: {[key: string]: string};
}

const KNOWN_MODES = new Set<CliMode>(["server", "client", "stop", "none"]);

class CLI {
    private static normalizeArgs(argv?: string[]): string[] {
        return argv ?? process.argv.slice(2);
    }

    public static readSimpleOptions = (argv?: string[]) : { [key: string]: string } => {
        let result : { [key: string]: string } = {};
        let items : Array<string> = CLI.normalizeArgs(argv);
        let currentKey : string = "";
        for(let item of items) {
            if(item.startsWith("-") && item.length > 1) {
                currentKey = item.replace(/^[-]+/ig,"");
                let idx = currentKey.indexOf("=");
                if(idx > 0) {
                    let key = currentKey.substring(0, idx);
                    let value = currentKey.substring(idx+1);
                    result[key] = value;
                    currentKey = "";
                } else {
                    result[currentKey] = "";
                }
            } else if(!item) {
            } else if(result[currentKey] != undefined) {
                result[currentKey] = item;
                currentKey = "";
            }
        }
        return result;
    }

    public static parseCommandLine(argv?: string[]): ParsedCommandLine {
        const items = CLI.normalizeArgs(argv);
        let mode: CliMode = "none";
        const optionTokens: string[] = [];
        for(let item of items) {
            if(mode == "none" && !item.startsWith("-") && KNOWN_MODES.has(item as CliMode) && item != "none") {
                mode = item as CliMode;
                continue;
            }
            optionTokens.push(item);
        }
        return {
            mode,
            options: CLI.readSimpleOptions(optionTokens)
        };
    }
}

export { CLI, CliMode, ParsedCommandLine };
export default CLI;
