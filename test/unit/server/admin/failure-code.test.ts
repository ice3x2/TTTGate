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
//   4. 다른 모듈이 만든 실패의 문구(X.message)를 넘기면 그 실패의 values(...X.values)도 넘긴다. 문구가 리터럴·상수도
//      X.message 도 아닌 식이면 code·message 밖의 값 필드를 함께 보낸다.
//   5. sendApiEnvelope 는 sendApiSuccess·sendApiFailure 안에서만 부른다(성공 여부를 값으로 고르는 응답이 code 를 빠뜨리지 않게).
//   6. values 의 키로 응답 봉투 필드(success·partial·failedScopes·warnings·code·message)를 쓰지 않는다.
//   7. res.writeHead(4xx·5xx) 로 실패 응답을 직접 쓰지 않는다. sendApiSuccess·ctx.ok 로 4xx·5xx 를 보내지 않는다.
// 정적 파일(비 API)의 404 텍스트 응답(writeHead(404) 바로 뒤 end('Not Found'))은 관리 화면이 오류 문구로 쓰지 않으므로 대상이 아니다.
// 또 src/server/rbac·src/server/security 와 설정 검증(ServerOptionStore·TunnelingOption)에서 실패를 만드는 곳을 읽어,
// 템플릿 문구를 쓰는 실패가 values 를 갖는지, 넘겨받은 실패의 문구(X.message)를 쓰면 그 values 도 갖는지 확인한다.
// 끝으로 두 곳을 함께 읽어, 같은 code 의 값 키가 곳마다 다르지 않은지 확인한다(값 키를 정적으로 알 수 있는 곳만).

const SERVER_DIR = path.join(__dirname, "../../../../src/server");
const ADMIN_DIR = path.join(SERVER_DIR, "admin");
const RESULT_DIRS = [path.join(SERVER_DIR, "rbac"), path.join(SERVER_DIR, "security")];
const RESULT_FILES = [path.join(SERVER_DIR, "ServerOptionStore.ts"), path.join(SERVER_DIR, "../types/TunnelingOption.ts")];
const NOT_FOUND_TEXT = "Not Found";
const VALUES_MISSING = "문구에 끼운 값을 별도 필드로 보내지 않는다";
const FORWARDED_VALUES_MISSING = "전달한 실패의 값을 보내지 않는다";
const RESERVED_VALUE_KEY = "values 의 키가 응답 봉투 필드를 덮는다";
const VALUE_KEYS_DIFFER = "같은 code 의 값 키가 곳마다 다르다";
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

/** 문구가 정해진 글인가: 리터럴, 이 파일 상수의 message, 그것들을 고르는 조건식·|| 식. */
const isStaticText = (source: ts.SourceFile, node: ts.Expression): boolean => {
    if(isLiteralText(node) || isConstMessage(source, node)) return true;
    if(ts.isParenthesizedExpression(node)) return isStaticText(source, node.expression);
    if(ts.isConditionalExpression(node)) return isStaticText(source, node.whenTrue) && isStaticText(source, node.whenFalse);
    return false;
};

/** 문구가 넘겨받은 실패의 문구(X.message, X.message || '...')면 X. 아니면 undefined. */
const forwardedFrom = (node: ts.Expression): string | undefined => {
    if(ts.isParenthesizedExpression(node)) return forwardedFrom(node.expression);
    if(ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
        && isLiteralText(node.right)) return forwardedFrom(node.left);
    return ts.isPropertyAccessExpression(node) && node.name.text === "message" ? node.expression.getText() : undefined;
};

const isValuesOf = (node: ts.Expression, from: string): boolean =>
    ts.isPropertyAccessExpression(node) && node.name.text === "values" && node.expression.getText() === from;

/** 객체가 X.values 를 펼치거나(...X.values) values: X.values 로 갖는가. */
const spreadsValuesOf = (literal: ts.ObjectLiteralExpression, from: string): boolean =>
    literal.properties.some((property) => (ts.isSpreadAssignment(property) && isValuesOf(property.expression, from))
        || (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "values" && isValuesOf(property.initializer, from)));

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
    if(message && ts.isPropertyAssignment(message) && !isStaticText(source, message.initializer)) {
        const from = forwardedFrom(message.initializer);
        if(from !== undefined ? !spreadsValuesOf(payload, from)
            : !payload.properties.some((property) => property !== code && property !== message)) return FORWARDED_VALUES_MISSING;
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
                else if(!isStaticText(source, args[2])) {
                    const from = forwardedFrom(args[2]);
                    const values = args[3];
                    const forwards = from === undefined ? values !== undefined
                        : values !== undefined && (isValuesOf(values, from) || (ts.isObjectLiteralExpression(values) && spreadsValuesOf(values, from)));
                    if(!forwards) report(node, FORWARDED_VALUES_MISSING);
                }
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

/** 실패 결과 객체인가: code 를 갖거나, success·ok 가 false 다. */
const isFailureObject = (literal: ts.ObjectLiteralExpression): boolean => {
    if(propertyNamed(literal, "code")) return true;
    return ["success", "ok"].some((name) => {
        const flag = propertyNamed(literal, name);
        if(flag === undefined || !ts.isPropertyAssignment(flag)) return false;
        const value = ts.isAsExpression(flag.initializer) ? flag.initializer.expression : flag.initializer;
        return value.kind === ts.SyntaxKind.FalseKeyword;
    });
};

/**
 * 실패를 만드는 곳(rbac·security). 다음 둘이 템플릿 문구면 끼운 값을 values 로도 갖는다.
 *   - code 와 message 를 가진 객체 리터럴: 같은 객체의 values 필드.
 *   - 실패 코드 리터럴 바로 뒤에 템플릿 문구를 넘기는 호출(failure(422, 'x', `...`), invalid('x', `...`)): 그 다음 인자.
 */
const scanResults = (file: string): Finding[] => {
    const {source, findings, report} = parse(file);
    const visit = (node: ts.Node): void => {
        if(ts.isObjectLiteralExpression(node) && isFailureObject(node)) {
            const message = propertyNamed(node, "message");
            if(message && ts.isPropertyAssignment(message) && ts.isTemplateExpression(message.initializer)) {
                const values = propertyNamed(node, "values");
                if(!values || !ts.isPropertyAssignment(values) || !valuesCover(message.initializer, values.initializer)) report(node, VALUES_MISSING);
                else if(hasReservedKey(values.initializer)) report(node, RESERVED_VALUE_KEY);
            }
            const from = message && ts.isPropertyAssignment(message) ? forwardedFrom(message.initializer) : undefined;
            if(from !== undefined && !spreadsValuesOf(node, from)) report(node, FORWARDED_VALUES_MISSING);
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

/** 펼치기가 없는 객체 리터럴의 키. 펼치기가 있으면 키를 정적으로 알 수 없다(undefined). */
const keysOf = (node: ts.Expression | undefined, skip: ReadonlySet<string> = new Set()): string[] | undefined => {
    if(node === undefined || !ts.isObjectLiteralExpression(node) || node.properties.some((property) => !ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))) return undefined;
    return node.properties.map((property) => property.name!.getText()).filter((name) => !skip.has(name)).sort();
};

/**
 * payload 가운데 문구에 끼운 값을 담은 필드의 키. payload 에는 값이 아닌 응답 필드(updated·failedScopes 등)도 섞이므로
 * 템플릿 문구에 끼운 값을 담은 필드만 값 키로 본다. 문구가 템플릿이 아니거나 펼치기가 있으면 undefined 다.
 */
const templateKeysOf = (payload: ts.ObjectLiteralExpression): string[] | undefined => {
    const message = propertyNamed(payload, "message");
    if(!message || !ts.isPropertyAssignment(message) || !ts.isTemplateExpression(message.initializer)) return undefined;
    if(payload.properties.some((property) => ts.isSpreadAssignment(property))) return undefined;
    const names = message.initializer.templateSpans.map((span) => valueNameOf(span.expression));
    return payload.properties.filter((property) => property !== message && (
        ts.isShorthandPropertyAssignment(property) ? names.includes(property.name.text)
            : ts.isPropertyAssignment(property) && ((ts.isIdentifier(property.name) && names.includes(property.name.text)) || names.includes(valueNameOf(property.initializer)))
    )).map((property) => property.name!.getText()).sort();
};

type ValueKeys = {code: string; keys: string[]; finding: Finding};

/** code 리터럴과, 그 실패가 함께 보내는 값 키(정적으로 알 수 있고 하나 이상인 것만). */
const valueKeysIn = (file: string): ValueKeys[] => {
    const {source} = parse(file);
    const found: ValueKeys[] = [];
    const add = (node: ts.Node, code: ts.Expression | undefined, keys: string[] | undefined): void => {
        if(code === undefined || !ts.isStringLiteral(code) || keys === undefined || keys.length === 0) return;
        found.push({code: code.text, keys, finding: {
            file: path.basename(file), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            text: node.getText().split("\n")[0].slice(0, 120), problem: VALUE_KEYS_DIFFER,
        }});
    };
    const codeOf = (literal: ts.ObjectLiteralExpression): ts.Expression | undefined => {
        const code = propertyNamed(literal, "code");
        return code && ts.isPropertyAssignment(code) ? code.initializer : undefined;
    };
    const visit = (node: ts.Node): void => {
        if(ts.isCallExpression(node)) {
            const name = nameOf(node.expression);
            const args = node.arguments;
            if(node.expression.getText() === "ctx.fail") add(node, args[1], keysOf(args[3]));
            else if((name === "sendApiFailure" || name === "sendFailure" || name === "fail") && args[2] && ts.isObjectLiteralExpression(args[2])) {
                add(node, codeOf(args[2]), templateKeysOf(args[2]));
            } else {
                args.forEach((arg, index) => {
                    if(ts.isStringLiteral(arg) && FAILURE_CODE.test(arg.text) && index + 2 < args.length) add(node, arg, keysOf(args[index + 2]));
                });
            }
        }
        if(ts.isObjectLiteralExpression(node) && !ts.isCallExpression(node.parent)) {
            const values = propertyNamed(node, "values");
            if(values && ts.isPropertyAssignment(values)) add(node, codeOf(node), keysOf(values.initializer));
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
};

/**
 * 같은 code 를 쓰는 곳들의 값 키가 서로 맞는가. 화면은 code 하나에 문구 하나를 쓰므로, 그 문구의 자리표시자가 될 키를
 * 모든 곳이 보내야 한다. 다른 응답 필드는 더 있어도 된다. 그래서 모든 곳이 가진 키(교집합)가 어느 한 곳의 키 전부와 같아야 한다.
 */
const valueKeyFindings = (files: string[]): Finding[] => {
    const byCode = new Map<string, ValueKeys[]>();
    files.flatMap(valueKeysIn).forEach((item) => byCode.set(item.code, [...(byCode.get(item.code) ?? []), item]));
    return [...byCode.values()].flatMap((items) => {
        const common = items.map((item) => item.keys).reduce((left, right) => left.filter((key) => right.includes(key)));
        return items.some((item) => item.keys.length === common.length) ? [] : items.map((item) => item.finding);
    });
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
    const resultFiles = [...RESULT_DIRS.flatMap(tsFilesIn), ...RESULT_FILES];

    test("검사할 파일과 실패 응답 호출이 있다", () => {
        expect(files.length).toBeGreaterThan(5);
        expect(files.map((file) => path.basename(file))).toEqual(expect.arrayContaining(["AdminServer.ts", "rbacRoutes.ts", "passkeyRoutes.ts"]));
        expect(resultFiles.map((file) => path.basename(file))).toEqual(expect.arrayContaining(
            ["IdentityStore.ts", "IdentityTypes.ts", "TunnelOwnership.ts", "IpBlocklist.ts", "connectionSecurity.ts", "ServerOptionStore.ts", "TunnelingOption.ts"]));
        resultFiles.forEach((file) => expect(fs.existsSync(file)).toBe(true));
    });

    test("code 가 없거나 값을 별도 필드로 보내지 않는 실패 응답이 없다", () => {
        expect(files.flatMap(scan)).toEqual([]);
    });

    test("템플릿 문구로 만든 실패는 끼운 값을 values 로도 갖는다", () => {
        expect(resultFiles.flatMap(scanResults)).toEqual([]);
    });

    test("같은 code 는 어디서 보내도 같은 값 키를 쓴다", () => {
        expect(valueKeyFindings([...files, ...resultFiles])).toEqual([]);
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
            [7, VALUES_MISSING],
            [8, RESERVED_VALUE_KEY],
            [9, RESERVED_VALUE_KEY],
        ]);
    });

    test("검사는 넘겨받은 실패의 문구만 보내고 그 값을 빠뜨린 응답을 잡는다(M-1)", () => {
        const lines = [
            "this.sendApiFailure(res, 400, {code: 'trusted_clients_invalid', message: prepared.message || 'Invalid trusted clients'});",
            "this.sendApiFailure(res, 400, {code: 'trusted_clients_invalid', message: prepared.message || 'Invalid trusted clients', ...prepared.values});",
            "this.sendApiFailure(res, 400, {code: 'server_option_invalid', message: result.message, updated: false});",
            "this.sendApiFailure(res, 400, {code: 'server_option_invalid', message: result.message, ...other.values});",
            "deps.fail(res, 422, {...result.values, code: result.code, message: result.message});",
            "this.sendApiFailure(res, 422, {code: 'geo_invalid', message: describe(input)});",
            "this.sendApiFailure(res, 422, {code: 'geo_invalid', message: describe(input), country});",
            "ctx.fail(422, 'x_y', result.message, {});",
            "ctx.fail(422, 'x_y', result.message, result.values);",
            "ctx.fail(422, 'x_y', result.message, {...result.values, port});",
            "ctx.fail(422, 'x_y', ok ? 'Yes' : 'No');",
        ];
        expect(withSample(lines, scan).map((finding) => [finding.line, finding.problem])).toEqual([
            [1, FORWARDED_VALUES_MISSING],
            [3, FORWARDED_VALUES_MISSING],
            [4, FORWARDED_VALUES_MISSING],
            [6, FORWARDED_VALUES_MISSING],
            [8, FORWARDED_VALUES_MISSING],
        ]);
    });

    test("검사는 code 없는 실패 결과의 템플릿 문구와, 넘겨받은 문구의 값을 빠뜨린 결과를 잡는다(M-1)", () => {
        const lines = [
            "const notAddress = {ok: false as const, message: `${text} is not an IP address or CIDR range`};",
            "const notAddress = {ok: false as const, message: `${text} is not an IP address or CIDR range`, values: {address: text}};",
            "if(!address.ok) return {ok: false, code: 'invalid', message: address.message};",
            "if(!address.ok) return {ok: false, code: 'invalid', message: address.message, values: address.values};",
            "return {success: false, message: result.message};",
            "return {success: false, message: result.message, values: result.values};",
            "return {success: false, reason: 'parse', message: error instanceof Error ? error.message : String(error)};",
            "logger.info({message: `started ${port}`});",
        ];
        expect(withSample(lines, scanResults).map((finding) => [finding.line, finding.problem])).toEqual([
            [1, VALUES_MISSING],
            [3, FORWARDED_VALUES_MISSING],
            [5, FORWARDED_VALUES_MISSING],
        ]);
    });

    test("검사는 같은 code 에 서로 다른 값 키를 쓰는 곳을 잡는다(M-2)", () => {
        const lines = [
            "ctx.fail(404, 'user_not_found', `user not found: ${id}`, {id});",
            "return {success: false, status: 404, code: 'user_not_found', message: `user not found: ${id}`, values: {userId: id}};",
            "ctx.fail(404, 'user_not_found', 'User not found');",
            "this.sendApiFailure(res, 404, {code: 'not_found', message: `Port(${port}).`, port});",
            "this.sendApiFailure(res, 404, {code: 'not_found', message: `Port(${forwardPort}).`, forwardPort, port: forwardPort});",
            "ctx.fail(404, 'not_found', `Port(${port}).`, {port});",
            "return invalid('group_not_found', `group not found: ${id}`, {id});",
            "ctx.fail(404, 'group_not_found', `group not found: ${id}`, {groupId: id});",
            "ctx.fail(422, 'x_y', result.message, {...result.values});",
            "ctx.fail(422, 'x_y', 'z', {other: 1});",
            "this.sendApiFailure(res, 400, {code: 'tunnel_update_failed', message: 'Update failed.', forwardPort: option.forwardPort});",
            "ctx.fail(400, 'tunnel_update_failed', `Unable to update tunnel ${option.forwardPort}.`, {port: option.forwardPort});",
            "this.sendApiFailure(res, 500, {code: 'tunnel_commit_failed', message: `Unable to remove ${forwardPort}.`, forwardPort, failedScopes: []});",
            "ctx.fail(500, 'tunnel_commit_failed', `Unable to save tunnel ${option.forwardPort}.`, {port: option.forwardPort});",
        ];
        expect(withSample(lines, (file) => valueKeyFindings([file])).map((finding) => [finding.line, finding.problem])).toEqual([
            [1, VALUE_KEYS_DIFFER],
            [2, VALUE_KEYS_DIFFER],
            [7, VALUE_KEYS_DIFFER],
            [8, VALUE_KEYS_DIFFER],
            [13, VALUE_KEYS_DIFFER],
            [14, VALUE_KEYS_DIFFER],
        ]);
    });
});
