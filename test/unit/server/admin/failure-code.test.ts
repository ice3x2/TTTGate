import fs from "fs";
import path from "path";
import ts from "typescript";

// 이슈 349 FR-7·AC-4a — 관리 화면이 부르는 API 의 실패 응답(4xx·5xx)은 모두 code 를 가진다.
// 화면은 code 로 문구를 고르고, 문구에 들어가는 값(포트 번호 등)은 응답의 별도 필드에서 받는다.
// src/server/admin 의 소스를 구문 트리로 읽어 실패 응답을 보내는 호출을 모두 찾고 다음을 확인한다.
//   1. ctx.fail(status, code, message, values?) 의 code 가 빈 문자열이 아니다.
//   2. sendApiFailure·sendFailure·fail(res, status, payload) 의 payload 에 code 가 있다.
//      payload 가 변수면 그 변수는 ApiFailure 로 형을 적은 매개변수나 상수여야 한다(형 검사가 호출하는 쪽의 code 를 강제한다).
//   3. 문구가 값을 끼워 넣는 템플릿이면 그 값을 별도 필드로도 보낸다.
//   4. sendApiEnvelope 는 sendApiSuccess·sendApiFailure 안에서만 부른다(성공 여부를 값으로 고르는 응답이 code 를 빠뜨리지 않게).
// 정적 파일(비 API)의 404 텍스트 응답은 관리 화면이 오류 문구로 쓰지 않으므로 대상이 아니다.

const ADMIN_DIR = path.join(__dirname, "../../../../src/server/admin");
const ENVELOPE_OWNERS = new Set(["sendApiSuccess", "sendApiFailure"]);

type Finding = {file: string; line: number; text: string; problem: string};

const nameOf = (callee: ts.Expression): string | undefined => {
    if(ts.isIdentifier(callee)) return callee.text;
    if(ts.isPropertyAccessExpression(callee)) return callee.name.text;
    return undefined;
};

const propertyNamed = (literal: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined =>
    literal.properties.find((property) => property.name !== undefined && ts.isIdentifier(property.name) && property.name.text === name);

const isEmptyString = (node: ts.Node | undefined): boolean =>
    node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === "";

const constObjectOf = (source: ts.SourceFile, name: string): ts.ObjectLiteralExpression | undefined => {
    let found: ts.ObjectLiteralExpression | undefined;
    const visit = (node: ts.Node): void => {
        if(ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name
            && node.initializer && ts.isObjectLiteralExpression(node.initializer)) found = node.initializer;
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
};

const typedApiFailure = (type: ts.TypeNode | undefined): boolean => type !== undefined && /\bApiFailure\b/.test(type.getText());

/** 변수가 ApiFailure 로 형을 적은 바깥 함수의 매개변수거나 상수인가. */
const isTypedApiFailure = (source: ts.SourceFile, node: ts.Identifier): boolean => {
    for(let current: ts.Node | undefined = node.parent; current; current = current.parent) {
        if(!ts.isFunctionLike(current)) continue;
        const parameter = current.parameters.find((item) => ts.isIdentifier(item.name) && item.name.text === node.text);
        if(parameter) return typedApiFailure(parameter.type);
    }
    let constant = false;
    const visit = (child: ts.Node): void => {
        if(ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.name.text === node.text && typedApiFailure(child.type)) constant = true;
        ts.forEachChild(child, visit);
    };
    visit(source);
    return constant;
};

const payloadProblem = (source: ts.SourceFile, payload: ts.Expression | undefined): string | undefined => {
    if(payload === undefined) return "payload 가 없다";
    if(ts.isIdentifier(payload)) return isTypedApiFailure(source, payload) ? undefined : "payload 변수가 ApiFailure 매개변수나 상수가 아니다";
    if(!ts.isObjectLiteralExpression(payload)) return "payload 가 객체 리터럴도 ApiFailure 매개변수도 아니다";
    const code = propertyNamed(payload, "code");
    const spreadCode = payload.properties.some((property) => ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression)
        && constObjectOf(source, property.expression.text) !== undefined && propertyNamed(constObjectOf(source, property.expression.text)!, "code") !== undefined);
    if(!code && !spreadCode) return "code 가 없다";
    if(code && ts.isPropertyAssignment(code) && isEmptyString(code.initializer)) return "code 가 빈 문자열이다";
    const message = propertyNamed(payload, "message");
    if(message && ts.isPropertyAssignment(message) && ts.isTemplateExpression(message.initializer)) {
        const others = payload.properties.filter((property) => property !== code && property !== message);
        if(others.length === 0) return "문구에 끼운 값을 별도 필드로 보내지 않는다";
    }
    return undefined;
};

const scan = (file: string): Finding[] => {
    const text = fs.readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const findings: Finding[] = [];
    const report = (node: ts.Node, problem: string) => findings.push({
        file: path.basename(file), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text: node.getText().split("\n")[0].slice(0, 120), problem,
    });
    const enclosingMethod = (node: ts.Node): string | undefined => {
        for(let current: ts.Node | undefined = node.parent; current; current = current.parent) {
            if(ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
        }
        return undefined;
    };
    const visit = (node: ts.Node): void => {
        if(ts.isCallExpression(node)) {
            const name = nameOf(node.expression);
            const args = node.arguments;
            if(node.expression.getText() === "ctx.fail") {
                if(args.length < 3 || isEmptyString(args[1])) report(node, "code 가 없다");
                else if(ts.isTemplateExpression(args[2]) && args.length < 4) report(node, "문구에 끼운 값을 별도 필드로 보내지 않는다");
            } else if(name === "sendApiFailure" || name === "sendFailure" || (name === "fail" && args.length >= 2)) {
                const problem = payloadProblem(source, args[2]);
                if(problem) report(node, problem);
            } else if(name === "sendApiEnvelope" && !ENVELOPE_OWNERS.has(enclosingMethod(node) ?? "")) {
                report(node, "sendApiEnvelope 를 직접 부른다");
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return findings;
};

describe("이슈 349 AC-4a — 관리 API 의 실패 응답은 code 를 가진다", () => {
    const files = fs.readdirSync(ADMIN_DIR).filter((name) => name.endsWith(".ts")).map((name) => path.join(ADMIN_DIR, name));

    test("검사할 파일과 실패 응답 호출이 있다", () => {
        expect(files.length).toBeGreaterThan(5);
        expect(files.map((file) => path.basename(file))).toEqual(expect.arrayContaining(["AdminServer.ts", "rbacRoutes.ts", "passkeyRoutes.ts"]));
    });

    test("code 가 없거나 값을 별도 필드로 보내지 않는 실패 응답이 없다", () => {
        expect(files.flatMap(scan)).toEqual([]);
    });

    test("검사는 code 가 빠진 응답, 값만 문구에 끼운 응답, 형을 적지 않은 전달 변수를 잡는다", () => {
        const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "failure-code-"));
        try {
            const sample = path.join(dir, "sample.ts");
            fs.writeFileSync(sample, [
                "this.sendApiFailure(res, 404, {message: 'Not Found'});",
                "ctx.fail(404, 'not_found', `External port(${port}) is not configured.`);",
                "const send = (payload) => this.sendApiFailure(res, 429, payload);",
                "this.sendApiFailure(res, 401);",
                "this.sendApiEnvelope(res, ok ? 200 : 400, {success: ok});",
                "ctx.fail(404, 'not_found', `External port(${port}) is not configured.`, {port});",
                "const typed = (payload: ApiFailure) => this.sendApiFailure(res, 429, payload);",
                "guard.fail(req);",
                "const FAILED: ApiFailure = {code: 'login_failed'};",
                "this.sendApiFailure(res, 401, FAILED);",
            ].join("\n"));
            expect(scan(sample).map((finding) => [finding.line, finding.problem])).toEqual([
                [1, "code 가 없다"],
                [2, "문구에 끼운 값을 별도 필드로 보내지 않는다"],
                [3, "payload 변수가 ApiFailure 매개변수나 상수가 아니다"],
                [4, "payload 가 없다"],
                [5, "sendApiEnvelope 를 직접 부른다"],
            ]);
        } finally {
            fs.rmSync(dir, {recursive: true, force: true});
        }
    });
});
