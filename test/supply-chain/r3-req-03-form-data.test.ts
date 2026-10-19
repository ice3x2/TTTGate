/**
 * R3-REQ-03 — form-data ≥ 4.0.4 고정 검증 (GHSA-fjxv-7rqg-78g4).
 * NO-MOCK: 실 package.json overrides 필드 + lockfile 해소 결과 검증.
 * boundary uniqueness 는 form-data 라이브러리 자체 책임이며, 상위 버전 고정이
 *   Math.random 약점 수정(crypto.randomBytes 전환) 효과를 담보한다.
 */
import * as fs from "fs";
import * as path from "path";

const repoRoot = path.resolve(__dirname, "..", "..");

const parseVersion = (v: string): [number, number, number] => {
    // 캐럿/틸드/범위 접두사 제거
    const clean = v.replace(/^[\^~>=<\s]+/, "").split(/[\s|]/)[0];
    const parts = clean.split(".").map((x) => parseInt(x, 10));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
};

const atLeast = (actual: string, min: [number, number, number]): boolean => {
    const [a, b, c] = parseVersion(actual);
    const [x, y, z] = min;
    if(a !== x) return a > x;
    if(b !== y) return b > y;
    return c >= z;
};

describe("R3-REQ-03 form-data >= 4.0.4 (boundary uniqueness)", () => {
    test("package.json overrides.form-data >= 4.0.4", () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
        expect(pkg.overrides).toBeDefined();
        expect(pkg.overrides["form-data"]).toBeDefined();
        expect(atLeast(pkg.overrides["form-data"], [4, 0, 4])).toBe(true);
    });

    test("(negative) 4.0.3 이하 버전은 게이트를 통과하지 못함", () => {
        expect(atLeast("^4.0.3", [4, 0, 4])).toBe(false);
        expect(atLeast("4.0.3", [4, 0, 4])).toBe(false);
        expect(atLeast("3.0.9", [4, 0, 4])).toBe(false);
    });

    test("(negative) boundary uniqueness — 취약 버전 Math.random 대비 신규 버전 crypto.randomBytes 요구를 문서화", () => {
        // 본 테스트는 라이브러리 재구현이 아닌 버전 고정의 의도를 코드로 고정한다.
        // 취약 버전(< 4.0.4) 은 boundary 에 Math.random 을 사용하므로 예측 가능.
        // 고정 대상: form-data >= 4.0.4 (crypto.randomBytes 전환 버전).
        const MIN_FIXED: [number, number, number] = [4, 0, 4];
        expect(atLeast("4.0.4", MIN_FIXED)).toBe(true);
        expect(atLeast("4.1.0", MIN_FIXED)).toBe(true);
        expect(atLeast("5.0.0", MIN_FIXED)).toBe(true);
    });

    test("lockfile 에 form-data 버전이 존재하면 모두 >= 4.0.4", () => {
        const lockPath = path.join(repoRoot, "package-lock.json");
        if(!fs.existsSync(lockPath)) {
            // lockfile 재생성 전 단계에서는 skip — P2 단계에서 재검증.
            return;
        }
        const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        const offenders: Array<{key: string; version: string}> = [];
        const packages = lock.packages || {};
        for(const [key, meta] of Object.entries<any>(packages)) {
            if(!meta || typeof meta !== "object") continue;
            if(!key.includes("form-data")) continue;
            if(!meta.version) continue;
            if(!atLeast(meta.version, [4, 0, 4])) offenders.push({key, version: meta.version});
        }
        expect(offenders).toEqual([]);
    });
});
