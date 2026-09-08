import fs from "fs";
import path from "path";

// Explicit one-shot OS-call fault boundary. Successful operations still use real
// files, HTTP and listeners; this fixture is not described as mock-free.
export const failFileOperation = (target: string, phase: "stage" | "publish", persistent = false) => {
    const write = fs.writeFileSync;
    const rename = fs.renameSync;
    const writeAsync = fs.writeFile;
    const renameAsync = fs.rename;
    let hits = 0;
    const failed = (file: any) => {
        const name = path.basename(String(file));
        if((persistent && hits > 0) || ((phase === "stage" ? name.startsWith(`.${target}.`) : name === target) && hits === 0)) {
            hits++;
            return Object.assign(new Error(`fixture EIO ${phase} ${target}`), {code: "EIO"});
        }
    };
    if(phase === "stage") {
        (fs as any).writeFileSync = (...args: any[]) => { const error = failed(args[0]); if(error) throw error; return (write as any)(...args); };
        (fs as any).writeFile = (...args: any[]) => { const error = failed(args[0]); if(error) return args[args.length - 1](error); return (writeAsync as any)(...args); };
    } else {
        (fs as any).renameSync = (...args: any[]) => { const error = failed(args[1]); if(error) throw error; return (rename as any)(...args); };
        (fs as any).rename = (...args: any[]) => { const error = failed(args[1]); if(error) return args[args.length - 1](error); return (renameAsync as any)(...args); };
    }
    return {hits: () => hits, close: () => { fs.writeFileSync = write; fs.renameSync = rename; fs.writeFile = writeAsync; fs.rename = renameAsync; }};
};

