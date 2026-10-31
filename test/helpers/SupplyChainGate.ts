import * as fs from "fs";
import {SpawnSyncReturns} from "child_process";
import * as path from "path";

const gate = require("../../scripts/supply-chain-gate.cjs");
export const readAuditReport: (result: SpawnSyncReturns<string>) => any = gate.readAuditReport;
export const readDependencyTree: (result: SpawnSyncReturns<string>) => any = gate.readDependencyTree;
export const runNpm = (args: string[]): SpawnSyncReturns<string> => gate.runNpm(args, path.resolve(__dirname, "../.."));
export const audit = (level: string): any => readAuditReport(runNpm([
    "audit", "--omit=dev", `--audit-level=${level}`, "--json",
]));
export const onlineTest = process.env.SUPPLY_CHAIN_ONLINE === "1" ? test : test.skip;

/** 저장소 루트 기준 경로의 JSON 파일을 읽는다. */
export const readRepoJson = (file: string): any => JSON.parse(fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8"));

/** 버전 문자열(범위 기호 포함)을 비교할 수 있는 수로 바꾼다. 프리릴리스는 고친 버전보다 앞이므로 비교하지 않고 실패한다. */
export const numericVersion = (version: string): number => {
    const bare = version.replace(/^[\^~>=<\s]+/, "").trim();
    if(/-/.test(bare.split("+")[0])) throw new Error(`prerelease version is not supported: ${version}`);
    const [major, minor, patch] = bare.split("+")[0].split(".").map((part) => parseInt(part, 10) || 0);
    return major * 1e6 + minor * 1e3 + patch;
};

/** 잠금 파일(저장소 루트 기준 경로)에서 그 패키지로 설치되는 모든 버전. */
export const installedVersions = (lockFile: string, name: string): string[] =>
    Object.entries<any>(readRepoJson(lockFile).packages ?? {})
        .filter(([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`))
        .map(([, meta]) => meta.version as string);
