/**
 * R3-REQ-02 — crypto-js 서버 체인 제거 검증 (NO-MOCK).
 * - package.json/package-build.json 의 서버 런타임 의존성에서 crypto-js/@types/crypto-js 제거됨.
 * - src/ 하위 서버 코드에서 crypto-js 임포트/사용이 0건임.
 * - admin/ 프런트엔드 체인은 별도 라운드 — 본 테스트 범위 외.
 */
import * as fs from "fs";
import * as path from "path";
import {readDependencyTree, runNpm} from "../helpers/SupplyChainGate";

const repoRoot = path.resolve(__dirname, "..", "..");

describe("R3-REQ-02 crypto-js removed from server runtime chain", () => {
    test.each(["package.json", "package-build.json"])("%s dependencies 에서 crypto-js 제거", (manifest) => {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, manifest), "utf8"));
        const deps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {})};
        expect(deps["crypto-js"]).toBeUndefined();
        expect(deps["@types/crypto-js"]).toBeUndefined();
    });

    test("src/ 서버 코드에서 crypto-js 임포트 0건", () => {
        // Windows/POSIX 공용: Node.js로 재귀 스캔
        const offenders: string[] = [];
        const scan = (dir: string) => {
            for(const entry of fs.readdirSync(dir, {withFileTypes: true})) {
                const full = path.join(dir, entry.name);
                if(entry.isDirectory()) scan(full);
                else if(entry.name.endsWith(".ts")) {
                    const content = fs.readFileSync(full, "utf8");
                    if(/from ["']crypto-js["']/.test(content) || /require\(["']crypto-js["']\)/.test(content)) {
                        offenders.push(full);
                    }
                }
            }
        };
        scan(path.join(repoRoot, "src"));
        expect(offenders).toEqual([]);
    });

    test("npm ls crypto-js (서버 루트) — (empty) 또는 admin 체인에 국한", () => {
        // 서버 루트 npm ls 는 서버 의존성 트리만 탐색. admin/ 은 별도 프로젝트.
        const parsed = readDependencyTree(runNpm(["ls", "--all", "--omit=dev", "--json"]));
        const flatten = (node: any, acc: string[]) => {
            if(!node || !node.dependencies) return;
            for(const [name, child] of Object.entries<any>(node.dependencies)) {
                if(name === "crypto-js") acc.push(child.version || "unknown");
                flatten(child, acc);
            }
        };
        const hits: string[] = [];
        flatten(parsed, hits);
        expect(hits).toEqual([]);
    });
});
