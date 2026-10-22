import {spawnSync} from "child_process";
import * as path from "path";

const root = path.resolve(__dirname, "../..");
const report = path.join(root, "scripts/supply-chain-gate.cjs");

test("admin advisory-only gate fails when audit registry is unreachable", () => {
    const result = spawnSync(process.execPath, [report, "--admin-high-report"], {
        cwd: root, encoding: "utf8", timeout: 30_000,
        env: {...process.env, npm_config_registry: "http://127.0.0.1:1",
            npm_config_fetch_retries: "0", npm_config_fetch_timeout: "1000"},
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid supply-chain result|Incomplete npm audit report|Supply-chain command failed/);
}, 35_000);
