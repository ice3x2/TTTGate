import fs from "fs";
import path from "path";
import ts from "typescript";
import {ADMIN_APP_START_BUDGET_MS, ADMIN_APP_TEST_TIMEOUT_MS} from "../helpers/adminApp";
import {ADMIN_BROWSER_START_BUDGET_MS, ADMIN_BROWSER_TEST_TIMEOUT_MS} from "../helpers/adminBrowser";

// #273 — 관리자 앱·브라우저 helper 를 쓰는 테스트의 제한은 helper 기동 예산보다 길어야 한다. 짧으면 부하에서 기동이 늦을 때
// helper 의 진단 오류 대신 jest 시간 초과로 끝나고 흔들린다. 제한은 helper 가 내보내는 상수로 맞춘다.
const root = process.cwd();
const files = ["test/admin", "test/e2e/browser"].flatMap((dir) => fs.readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith(".test.ts")).map((name) => path.join(dir, name).split(path.sep).join("/")));

const HOOKS = new Set(["beforeAll", "beforeEach", "afterAll", "afterEach"]);
const TESTS = new Set(["test", "it"]);

/** test.only.skip 같은 체인의 맨 앞 이름과, 체인에 each 가 있는지. */
const chainOf = (node: ts.Expression): {root: string; each: boolean} | undefined => {
    let each = false;
    let current: ts.Expression = node;
    while(ts.isPropertyAccessExpression(current)) {
        if(current.name.text === "each") each = true;
        current = current.expression;
    }
    return ts.isIdentifier(current) ? {root: current.text, each} : undefined;
};

/** jest 의 테스트·훅 호출과 jest.setTimeout 에서 제한 인자만 읽는다(일반 setTimeout 등은 보지 않는다). */
const timeoutArguments = (source: string): Array<{where: string; arg: ts.Expression | undefined}> => {
    const file = ts.createSourceFile("check.ts", source, ts.ScriptTarget.Latest, true);
    const found: Array<{where: string; arg: ts.Expression | undefined}> = [];
    const visit = (node: ts.Node) => {
        if(ts.isCallExpression(node)) {
            const callee = node.expression;
            const text = callee.getText(file);
            const name = () => `(${node.arguments[0]?.getText(file).slice(0, 40)})`;
            if(text === "jest.setTimeout") {
                found.push({where: "jest.setTimeout", arg: node.arguments[0]});
            } else if(ts.isCallExpression(callee) || ts.isTaggedTemplateExpression(callee)) {
                // test.each(table)(name, fn, timeout) · test.only.each`table`(name, fn, timeout)
                const tag = ts.isCallExpression(callee) ? callee.expression : callee.tag;
                const chain = chainOf(tag);
                if(chain?.each && TESTS.has(chain.root) && node.arguments.length >= 3) found.push({where: `test.each${name()}`, arg: node.arguments[2]});
            } else {
                // test(name, fn, timeout) · it.only(...) · test.skip(...) — test.each(table) 자체는 위 분기에서 본다.
                const chain = chainOf(callee);
                if(chain && TESTS.has(chain.root) && !chain.each && node.arguments.length >= 3) found.push({where: `${chain.root}${name()}`, arg: node.arguments[2]});
                else if(HOOKS.has(text) && node.arguments.length >= 2) found.push({where: text, arg: node.arguments[1]});
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return found;
};

/** 파일이 helper 에서 import 한 이름. 같은 이름을 파일 안에서 다시 만들면 허용하지 않는다. */
const helperImports = (source: string): Set<string> => {
    const file = ts.createSourceFile("check.ts", source, ts.ScriptTarget.Latest, true);
    const names = new Set<string>();
    for(const statement of file.statements) {
        if(!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        if(!/helpers\/admin(App|Browser)$/.test(statement.moduleSpecifier.text)) continue;
        const bindings = statement.importClause?.namedBindings;
        if(bindings && ts.isNamedImports(bindings)) for(const element of bindings.elements) {
            if(!element.propertyName) names.add(element.name.text);
        }
    }
    return names;
};

/** 허용: helper 에서 import 한 정한 상수 이름, 또는 기준 이상의 숫자 리터럴. 그 밖의 식은 값을 알 수 없으므로 위반이다. */
const violations = (source: string, minimum: number, names: string[]): string[] => {
    const problems: string[] = [];
    const imported = helperImports(source);
    const allowed = names.filter((name) => imported.has(name));
    const found = timeoutArguments(source);
    if(!found.some((entry) => entry.where === "jest.setTimeout")) problems.push("no jest.setTimeout(...) for the file");
    for(const {where, arg} of found) {
        if(!arg) { problems.push(`${where}: no value`); continue; }
        if(ts.isIdentifier(arg) && allowed.includes(arg.text)) continue;
        if(ts.isNumericLiteral(arg) && Number(arg.text.replace(/_/g, "")) >= minimum) continue;
        problems.push(`${where}: ${arg.getText()}`);
    }
    return problems;
};

describe("admin test timeouts cover the helper start budget (#273)", () => {
    test("the test timeouts leave room for work after the start budget", () => {
        expect(ADMIN_APP_TEST_TIMEOUT_MS).toBeGreaterThan(ADMIN_APP_START_BUDGET_MS);
        expect(ADMIN_BROWSER_TEST_TIMEOUT_MS).toBeGreaterThan(ADMIN_BROWSER_START_BUDGET_MS);
    });

    test("the check reads only jest timeouts, not ordinary timers in test bodies", () => {
        const sample = `
            import {LIMIT_MS} from "../helpers/adminApp";
            jest.setTimeout(LIMIT_MS);
            beforeAll(async () => {}, 1_000);
            test("a", async () => { setTimeout(() => { kill(); }, 10_000); await page.waitForFunction(() => {}, 5000); }, 2 * 60_000);
            it.each([1])("b", async () => {}, SHORT);
            test.only.each([1])("c", async () => {}, 20_000);
            test.each\`x\${1}\`("d", async () => {}, 30_000);
            it.skip("e", async () => {}, LIMIT_MS);
            test("f", async () => {});
        `;
        expect(violations(sample, 100_000, ["LIMIT_MS"])).toEqual(["beforeAll: 1_000", `test("a"): 2 * 60_000`,
            "test.each(\"b\"): SHORT", "test.each(\"c\"): 20_000", "test.each(\"d\"): 30_000"]);
        // 같은 이름을 helper 에서 가져오지 않고 파일 안에서 만들면 허용하지 않는다.
        expect(violations(`const LIMIT_MS = 1000;\njest.setTimeout(LIMIT_MS);`, 100_000, ["LIMIT_MS"])).toEqual(["jest.setTimeout: LIMIT_MS"]);
    });

    test("the scan finds the files that use the helpers", () => {
        const users = files.filter((file) => /\bstartAdmin(App|Browser)\b/.test(fs.readFileSync(path.join(root, file), "utf-8")));
        expect(users.length).toBeGreaterThanOrEqual(20);
    });

    test.each(files)("%s sets a timeout no shorter than the helper budget (AC-1)", (file) => {
        const source = fs.readFileSync(path.join(root, file), "utf-8");
        const usesApp = /\bstartAdminApp\b/.test(source);
        const usesBrowser = /\bstartAdminBrowser\b/.test(source);
        if(!usesApp && !usesBrowser) return;
        const minimum = usesApp ? ADMIN_APP_TEST_TIMEOUT_MS : ADMIN_BROWSER_TEST_TIMEOUT_MS;
        const allowed = usesApp ? ["ADMIN_APP_TEST_TIMEOUT_MS"] : ["ADMIN_BROWSER_TEST_TIMEOUT_MS", "ADMIN_APP_TEST_TIMEOUT_MS"];
        expect(violations(source, minimum, allowed)).toEqual([]);
    });
});
