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
