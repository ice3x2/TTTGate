import fs from "node:fs";
import path from "node:path";

// 관리 화면 테스트의 가짜 런타임(admin-backend-driver.ts 의 stub)은 AdminServer 가 꼭 부르는 TTTServer 메서드를 모두 가져야 한다.
// 빠지면 그 API 가 500 으로 끝나 화면이 엉뚱하게 깨진다. 이슈 369 에서 상태 API 가 isClientConnected 를 부르게 되자
// 화면 테스트 89건이 "result.statuses is not iterable" 로 실패했다. 브라우저 없이 그 어긋남을 잡는다.
const ROOT = path.resolve(__dirname, "../..");
const ADMIN_DIR = path.join(ROOT, "src/server/admin");

/** AdminServer 쪽이 없으면 안 되는 것으로 부르는 런타임 메서드. `?.()` 로 부르는 것(없어도 되는 것)은 뺀다. */
const requiredRuntimeCalls = (): string[] => {
    const names = new Set<string>();
    for(const file of fs.readdirSync(ADMIN_DIR).filter((name) => name.endsWith(".ts"))) {
        const source = fs.readFileSync(path.join(ADMIN_DIR, file), "utf8");
        for(const match of source.matchAll(/_tttServer\??\.(\w+)\(/g)) names.add(match[1]);
    }
    return [...names].sort();
};

/** 가짜 런타임 객체(const stub = { ... };)에 정의된 메서드 이름. */
const stubMethods = (): Set<string> => {
    const source = fs.readFileSync(path.join(ROOT, "test/admin/admin-backend-driver.ts"), "utf8");
    const start = source.indexOf("const stub = {");
    const end = source.indexOf("\n};", start);
    expect(start).toBeGreaterThanOrEqual(0);
    const body = source.slice(start, end);
    return new Set([...body.matchAll(/^ {4}(?:async )?(\w+)\(/gm)].map((match) => match[1]));
};

test("가짜 런타임은 AdminServer 가 꼭 부르는 런타임 메서드를 모두 가진다", () => {
    const required = requiredRuntimeCalls();
    expect(required.length).toBeGreaterThan(0);
    const defined = stubMethods();
    expect(required.filter((name) => !defined.has(name))).toEqual([]);
});
