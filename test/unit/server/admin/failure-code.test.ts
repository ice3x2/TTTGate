import fs from "fs";
import path from "path";
import ts from "typescript";

// 이슈 349 FR-7·AC-4a — 관리 화면이 부르는 API 의 실패 응답(4xx·5xx)은 모두 code 를 가진다.
// 화면은 code 로 문구를 고르고, 문구에 들어가는 값(포트 번호 등)은 응답의 별도 필드에서 받는다.
// src/server/admin 의 소스를 구문 트리로 읽어 실패 응답을 보내는 호출을 모두 찾고 다음을 확인한다.
//   1. ctx.fail(status, code, message, values?) 의 code 가 빈 문자열이 아니다.
//   2. sendApiFailure·sendFailure·fail(res, status, payload) 의 payload 에 code 가 있다.
//      payload 가 변수면 그 변수는 ApiFailure 로 형을 적은 매개변수나 상수여야 한다(형 검사가 호출하는 쪽의 code 를 강제한다).
//   3. 문구가 값을 끼워 넣는 템플릿이면 끼운 값마다 같은 이름(또는 같은 식)의 필드를 함께 보낸다.
//   4. 다른 모듈이 만든 실패(문구가 리터럴이 아닌 ctx.fail, code·message 가 X.code·X.message 인 payload)를 넘기면 그 실패의 values 도 넘긴다.
//   5. sendApiEnvelope 는 sendApiSuccess·sendApiFailure 안에서만 부른다(성공 여부를 값으로 고르는 응답이 code 를 빠뜨리지 않게).
//   6. values 의 키로 응답 봉투 필드(success·partial·failedScopes·warnings·code·message)를 쓰지 않는다.
//   7. res.writeHead(4xx·5xx) 로 실패 응답을 직접 쓰지 않는다. sendApiSuccess·ctx.ok 로 4xx·5xx 를 보내지 않는다.
// 정적 파일(비 API)의 404 텍스트 응답(writeHead(404) 바로 뒤 end('Not Found'))은 관리 화면이 오류 문구로 쓰지 않으므로 대상이 아니다.
// 또 src/server/rbac·src/server/security 에서 실패를 만드는 곳을 읽어, 템플릿 문구를 쓰는 실패가 values 를 갖는지 확인한다.

const SERVER_DIR = path.join(__dirname, "../../../../src/server");
const ADMIN_DIR = path.join(SERVER_DIR, "admin");
const RESULT_DIRS = [path.join(SERVER_DIR, "rbac"), path.join(SERVER_DIR, "security")];
const NOT_FOUND_TEXT = "Not Found";
const VALUES_MISSING = "문구에 끼운 값을 별도 필드로 보내지 않는다";
const FORWARDED_VALUES_MISSING = "전달한 실패의 값을 보내지 않는다";
const RESERVED_VALUE_KEY = "values 의 키가 응답 봉투 필드를 덮는다";
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

const isLiteralText = (node: ts.Node): boolean => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

/** 끼운 값의 이름. String(x)·x.y·x.join(', ') 는 x·y·x 다. 필드 이름이나 필드 값의 이름과 견준다. */
const valueNameOf = (expression: ts.Expression): string => {
    if(ts.isIdentifier(expression)) return expression.text;
    if(ts.isPropertyAccessExpression(expression)) return expression.name.text;
    if(ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) return valueNameOf(expression.expression);
    if(ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) return valueNameOf(expression.expression.expression);
    if(ts.isCallExpression(expression) && expression.arguments.length === 1) return valueNameOf(expression.arguments[0]);
    return expression.getText();
};

/** 템플릿에 끼운 값이 모두 필드(같은 이름의 키, 또는 같은 값을 담은 키)로 있는가. */
const coversTemplate = (template: ts.TemplateExpression, properties: readonly ts.ObjectLiteralElementLike[]): boolean =>
    template.templateSpans.every((span) => {
        const name = valueNameOf(span.expression);
        return properties.some((property) => {
            if(ts.isShorthandPropertyAssignment(property)) return property.name.text === name;
            if(!ts.isPropertyAssignment(property)) return false;
            return (ts.isIdentifier(property.name) && property.name.text === name) || valueNameOf(property.initializer) === name;
        });
    });

/** 응답 봉투(sendApiEnvelope)의 필드. values 는 응답에 펼쳐지므로 이 이름을 키로 쓰면 실패가 성공처럼 보일 수 있다. */
const ENVELOPE_FIELDS = new Set(["success", "partial", "failedScopes", "warnings", "code", "message"]);

const hasReservedKey = (values: ts.Expression | undefined): boolean =>
    values !== undefined && ts.isObjectLiteralExpression(values) && values.properties.some((property) =>
        property.name !== undefined && ts.isIdentifier(property.name) && ENVELOPE_FIELDS.has(property.name.text));

const valuesCover = (template: ts.TemplateExpression, values: ts.Expression | undefined): boolean =>
    values !== undefined && ts.isObjectLiteralExpression(values) && coversTemplate(template, values.properties);

/** C.message 이고 C 가 이 파일의 상수 객체이며 그 message 가 리터럴인가. */
const isConstMessage = (source: ts.SourceFile, node: ts.Expression): boolean => {
    if(!ts.isPropertyAccessExpression(node) || node.name.text !== "message" || !ts.isIdentifier(node.expression)) return false;
    const constant = constObjectOf(source, node.expression.text);
    const message = constant && propertyNamed(constant, "message");
    return message !== undefined && ts.isPropertyAssignment(message) && isLiteralText(message.initializer);
};

const failStatusOf = (node: ts.Expression | undefined): boolean => {
    let found = false;
    const visit = (child: ts.Node): void => {
        if(ts.isNumericLiteral(child) && Number(child.text) >= 400) found = true;
        ts.forEachChild(child, visit);
    };
    if(node) visit(node);
    return found;
};

/** writeHead(404) 바로 다음 문장이 X.end('Not Found') 인가(정적 파일의 404 텍스트 응답). */
const isStaticNotFound = (call: ts.CallExpression): boolean => {
    const statement = call.parent;
    if(!ts.isExpressionStatement(statement) || !(ts.isBlock(statement.parent) || ts.isSourceFile(statement.parent))) return false;
    const statements = statement.parent.statements;
    const next = statements[statements.indexOf(statement) + 1];
    if(!next || !ts.isExpressionStatement(next) || !ts.isCallExpression(next.expression)) return false;
    const end = next.expression;
    return nameOf(end.expression) === "end" && end.arguments.length === 1 && isLiteralText(end.arguments[0])
        && (end.arguments[0] as ts.StringLiteral).text === NOT_FOUND_TEXT;
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
        if(!coversTemplate(message.initializer, others)) return VALUES_MISSING;
    }
    // 다른 모듈이 만든 실패를 넘기는 응답: code 와 message 가 같은 객체의 X.code·X.message 다.
    const sourceOf = (property: ts.ObjectLiteralElementLike | undefined, name: string): string | undefined =>
        property && ts.isPropertyAssignment(property) && ts.isPropertyAccessExpression(property.initializer) && property.initializer.name.text === name
            ? property.initializer.expression.getText() : undefined;
    const forwardedFrom = sourceOf(code, "code");
    if(forwardedFrom !== undefined && forwardedFrom === sourceOf(message, "message")) {
        const forwardsValues = payload.properties.some((property) => ts.isSpreadAssignment(property)
            && ts.isPropertyAccessExpression(property.expression) && property.expression.name.text === "values");
        if(!forwardsValues) return FORWARDED_VALUES_MISSING;
    }
    return undefined;
};

const parse = (file: string): {source: ts.SourceFile; findings: Finding[]; report: (node: ts.Node, problem: string) => void} => {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const findings: Finding[] = [];
    const report = (node: ts.Node, problem: string) => findings.push({
        file: path.basename(file), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text: node.getText().split("\n")[0].slice(0, 120), problem,
    });
    return {source, findings, report};
};

const scan = (file: string): Finding[] => {
    const {source, findings, report} = parse(file);
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
                else if(hasReservedKey(args[3])) report(node, RESERVED_VALUE_KEY);
                else if(ts.isTemplateExpression(args[2])) { if(!valuesCover(args[2], args[3])) report(node, VALUES_MISSING); }
                else if(!isLiteralText(args[2]) && !isConstMessage(source, args[2]) && args.length < 4) report(node, FORWARDED_VALUES_MISSING);
            } else if(node.expression.getText() === "ctx.ok") {
                if(failStatusOf(args[1])) report(node, "성공 응답으로 실패 상태를 보낸다");
            } else if(name === "sendApiSuccess") {
                if(failStatusOf(args[2])) report(node, "성공 응답으로 실패 상태를 보낸다");
            } else if(name === "writeHead") {
                if(failStatusOf(args[0]) && !isStaticNotFound(node)) report(node, "writeHead 로 실패 응답을 직접 쓴다");
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

const FAILURE_CODE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

/**
 * 실패를 만드는 곳(rbac·security). 다음 둘이 템플릿 문구면 끼운 값을 values 로도 갖는다.
 *   - code 와 message 를 가진 객체 리터럴: 같은 객체의 values 필드.
 *   - 실패 코드 리터럴 바로 뒤에 템플릿 문구를 넘기는 호출(failure(422, 'x', `...`), invalid('x', `...`)): 그 다음 인자.
 */
const scanResults = (file: string): Finding[] => {
    const {source, findings, report} = parse(file);
    const visit = (node: ts.Node): void => {
        if(ts.isObjectLiteralExpression(node) && propertyNamed(node, "code")) {
            const message = propertyNamed(node, "message");
            if(message && ts.isPropertyAssignment(message) && ts.isTemplateExpression(message.initializer)) {
                const values = propertyNamed(node, "values");
                if(!values || !ts.isPropertyAssignment(values) || !valuesCover(message.initializer, values.initializer)) report(node, VALUES_MISSING);
                else if(hasReservedKey(values.initializer)) report(node, RESERVED_VALUE_KEY);
            }
        }
        if(ts.isCallExpression(node)) {
            const args = node.arguments;
            args.forEach((arg, index) => {
                const code = args[index - 1];
                if(!ts.isTemplateExpression(arg) || code === undefined || !ts.isStringLiteral(code) || !FAILURE_CODE.test(code.text)) return;
                if(!valuesCover(arg, args[index + 1])) report(node, VALUES_MISSING);
                else if(hasReservedKey(args[index + 1])) report(node, RESERVED_VALUE_KEY);
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return findings;
};

const tsFilesIn = (dir: string): string[] => fs.readdirSync(dir).filter((name) => name.endsWith(".ts")).map((name) => path.join(dir, name));

const withSample = <T>(lines: string[], run: (file: string) => T): T => {
    const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "failure-code-"));
    try {
        const sample = path.join(dir, "sample.ts");
        fs.writeFileSync(sample, lines.join("\n"));
        return run(sample);
    } finally {
        fs.rmSync(dir, {recursive: true, force: true});
    }
};

describe("이슈 349 AC-4a — 관리 API 의 실패 응답은 code 를 가진다", () => {
    const files = tsFilesIn(ADMIN_DIR);
    const resultFiles = RESULT_DIRS.flatMap(tsFilesIn);

    test("검사할 파일과 실패 응답 호출이 있다", () => {
        expect(files.length).toBeGreaterThan(5);
        expect(files.map((file) => path.basename(file))).toEqual(expect.arrayContaining(["AdminServer.ts", "rbacRoutes.ts", "passkeyRoutes.ts"]));
        expect(resultFiles.map((file) => path.basename(file))).toEqual(expect.arrayContaining(["IdentityStore.ts", "IdentityTypes.ts", "TunnelOwnership.ts", "IpBlocklist.ts"]));
    });

    test("code 가 없거나 값을 별도 필드로 보내지 않는 실패 응답이 없다", () => {
        expect(files.flatMap(scan)).toEqual([]);
    });

    test("템플릿 문구로 만든 실패는 끼운 값을 values 로도 갖는다", () => {
        expect(resultFiles.flatMap(scanResults)).toEqual([]);
    });

    test("검사는 code 가 빠진 응답, 값만 문구에 끼운 응답, 형을 적지 않은 전달 변수를 잡는다", () => {
        const lines = [
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
        ];
        expect(withSample(lines, scan).map((finding) => [finding.line, finding.problem])).toEqual([
            [1, "code 가 없다"],
            [2, VALUES_MISSING],
            [3, "payload 변수가 ApiFailure 매개변수나 상수가 아니다"],
            [4, "payload 가 없다"],
            [5, "sendApiEnvelope 를 직접 부른다"],
        ]);
    });

    test("검사는 다른 모듈의 실패를 값 없이 넘기는 응답을 잡는다(H-1)", () => {
        const lines = [
            "ctx.fail(result.status, result.code, result.message);",
            "ctx.fail(result.status, result.code, result.message, result.values);",
            "this.sendApiFailure(res, admission.status, {code: admission.code, message: admission.message});",
            "this.sendApiFailure(res, admission.status, {code: admission.code, message: admission.message, ...admission.values});",
            "const ORIGIN = {code: 'passkey_origin_unsupported', message: 'Passkeys need a domain name.'};",
            "ctx.fail(422, ORIGIN.code, ORIGIN.message);",
            "this.sendApiFailure(res, decision.status, {code: decision.code, message: decision.status === 403 ? 'Forbidden' : 'Not Found'});",
        ];
        expect(withSample(lines, scan).map((finding) => [finding.line, finding.problem])).toEqual([
            [1, FORWARDED_VALUES_MISSING],
            [3, FORWARDED_VALUES_MISSING],
        ]);
    });

    test("검사는 writeHead·성공 응답으로 보내는 실패와, 끼운 값과 다른 필드만 보내는 응답을 잡는다(M-1)", () => {
        const lines = [
            "res.writeHead(500);",
            "res.end('oops');",
            "res.writeHead(404);",
            "res.end('Not Found');",
            "this.sendApiSuccess(res, {}, 409);",
            "ctx.ok({}, 422);",
            "ctx.ok({}, 201);",
            "this.sendApiFailure(res, 404, {code: 'not_found', message: `External port(${port}) is not configured.`, url});",
            "ctx.fail(404, 'not_found', `Port ${port} of ${host}.`, {port});",
            "this.sendApiFailure(res, 404, {code: 'not_found', message: `Port ${option.port}.`, port: option.port});",
            "this.sendApiFailure(res, 409, {code: 'passkey_limit', message: `Up to ${PASSKEY_LIMIT}.`, limit: PASSKEY_LIMIT});",
            "this.sendApiSuccess(res, {});",
            "ctx.fail(422, 'role_invalid', `role must be one of ${ROLES.join(', ')}`, {roles: ROLES});",
        ];
        expect(withSample(lines, scan).map((finding) => [finding.line, finding.problem])).toEqual([
            [1, "writeHead 로 실패 응답을 직접 쓴다"],
            [5, "성공 응답으로 실패 상태를 보낸다"],
            [6, "성공 응답으로 실패 상태를 보낸다"],
            [8, VALUES_MISSING],
            [9, VALUES_MISSING],
        ]);
    });

    test("검사는 템플릿 문구로 만들면서 values 가 없거나 모자란 실패를 잡는다(H-1)", () => {
        const lines = [
            "return {success: false, status: 409, code: 'username_taken', message: `username already taken: ${username}`};",
            "return {success: false, status: 409, code: 'username_taken', message: `username already taken: ${username}`, values: {username}};",
            "return {success: false, status: 422, code: 'owner_not_found', message: `owner ${String(value)} in ${group}`, values: {ownerId: value}};",
            "return invalid('password_too_short', `password must be at least ${MIN_PASSWORD_LENGTH} characters`);",
            "return invalid('password_too_short', `password must be at least ${MIN_PASSWORD_LENGTH} characters`, {min: MIN_PASSWORD_LENGTH});",
            "logger.error(`failed to remove deleted user ${userId}`);",
            "return {ok: false, message: `${text} is not an IP address`};",
            "return {success: false, status: 409, code: 'x_y', message: `bad ${success}`, values: {success}};",
            "return invalid('x_y', `bad ${partial}`, {partial});",
        ];
        expect(withSample(lines, scanResults).map((finding) => [finding.line, finding.problem])).toEqual([
            [1, VALUES_MISSING],
            [3, VALUES_MISSING],
            [4, VALUES_MISSING],
            [8, RESERVED_VALUE_KEY],
            [9, RESERVED_VALUE_KEY],
        ]);
    });
});
