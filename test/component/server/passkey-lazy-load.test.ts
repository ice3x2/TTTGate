import {spawnSync} from "child_process";
import path from "path";

// #336 — 패스키 라이브러리(@simplewebauthn/server)는 x509·ASN.1 모듈을 많이 읽어 느린 디스크에서 수십 초가 걸린다.
// 모든 CLI 명령과 클라이언트 모드가 이 비용을 내지 않도록 패스키 경로를 처음 부를 때만 읽는다. 빌드 결과로 확인한다.
jest.setTimeout(120_000);

const root = path.resolve(__dirname, "../../..");

it("관리 서버 모듈을 읽어도 패스키 라이브러리는 읽지 않는다", () => {
    const script = "require('./build/src/server/admin/AdminServer');"
        + "process.stdout.write(String(Object.keys(require.cache).filter((key) => key.includes('@simplewebauthn')).length));";
    const result = spawnSync(process.execPath, ["-e", script], {cwd: root, encoding: "utf8", timeout: 100_000});
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("0");
});
