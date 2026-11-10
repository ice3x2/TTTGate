import fs from "fs";
import path from "path";
import ts from "typescript";
import {translator} from "../../../admin/src/i18n";
import {serverErrorKeyOf} from "../../../admin/src/i18n/serverError";

// 이슈 349 FR-7 검토 M-2 — 서버가 실패 응답에 싣는 code 마다 관리 화면의 문구(serverError.<code>)가 있어야 한다.
// 문구가 없으면 한국어 화면에도 서버의 영어 문구가 그대로 보인다.
// 이 파일은 test/unit 에 있어 CI 의 fast 작업(npm run test:unit)이 매번 돌린다.

const root = path.resolve(__dirname, "../../..");

/**
 * 일부러 문구를 두지 않는 code. 같은 code 를 여러 곳에서 서로 다른 서버 문구와 함께 보낸다(묶음 code).
 * 문구 하나를 정하면 영어 화면에 지금 보이는 서버 문구가 바뀐다. 그래서 화면은 서버 문구를 그대로 보인다(이슈 349 에서 정했다).
 * 새 code 를 여기에 넣으려면 같은 이유가 있어야 한다. 서버 문구가 한 가지면 en.ts·ko.ts 에 문구를 더한다.
 */
const UNTRANSLATED_UMBRELLA_CODES: Readonly<Record<string, string>> = {
    // 서버 문구가 곳마다 다르다.
    forbidden: "'Forbidden' 과 'uploading a certificate requires tunnel:cert'",
    not_found: "'Not Found' 와 'External port(N) is not configured.' 등",
    invalid: "IP 차단 목록 검증 문구(주소·포트·메모 형식)",
    invalid_port: "'Invalid port', 'invalid port', 'forwardPort must be an integer from 1 to 65535'",
    invalid_certificate: "'Invalid certificate' 와 'Invalid certificate.'",
    certificate_apply_failed: "'Unable to apply administrator certificate' 와 'Invalid certificate'",
    user_not_found: "'User not found' 와 'user not found: <id>'",
    group_not_found: "'group not found' 와 'group not found: <id>'",
    username_invalid: "'username must be a string' 와 'username is invalid: <값>'",
    display_name_invalid: "'displayName must be a string' 와 'displayName is invalid: <값>'",
    password_too_short: "'temporaryPassword must be a string' 와 'password must be at least 8 characters'",
    attribute_enum_invalid: "그룹 속성마다 다른 'invalid <속성>' 문구",
    attribute_int_invalid: "그룹 속성마다 다른 'invalid <속성>: <값>' 문구",
    superuser_group_reserved: "일반 사용자와 슈퍼유저 계정에 따라 다른 문구",
    system_group_readonly: "슈퍼유저 그룹·기본 그룹 이름·삭제에 따라 다른 문구",
    trusted_clients_invalid: "검증 단계마다 다른 문구",
    tunnel_apply_failed: "'Unable to restart tunneling server.' 와 'Unable to apply compound tunneling option.'",
    tunnel_commit_failed: "저장 단계마다 다른 문구(포트 번호 포함)",
    tunnel_update_failed: "갱신 단계마다 다른 문구(검증 결과 포함)",
    ENROLLMENT_SUPERSEDED: "발급 확인과 코드 사용에 따라 다른 문구",
    // 서버 문구를 실행 중에 만든다(검증 결과·정책 위반 목록).
    duplicate: "차단된 주소와 범위를 넣은 문구",
    admin_security_policy: "보안 정책 위반 목록",
    audit_query_invalid: "감사 조회 조건의 검증 결과",
    geo_invalid: "국가 차단 설정의 검증 결과",
    identity_save_failed: "사용자 저장소의 검증 결과",
    server_option_invalid: "서버 설정의 검증 결과",
};

/**
 * 화면이 서버 문구를 쓰지 않는 code. LoginScreen 은 bootstrapRequired 응답을 errorMessageOf 없이 자기 문구(login.*)로 보인다.
 * 검토 L-B: bootstrap_required 도 같다. 서버는 이 code 를 invalidUsername·bootstrapRequired 플래그와 함께 보낸다.
 * 이 응답에는 서버 문구(message)도 없다. 그래서 serverError.<code> 문구를 두지 않는다.
 */
const SCREEN_OWNED_CODES: Readonly<Record<string, string>> = {
    bootstrap_password_weak: "LoginScreen 이 weakPassword 로 login.passwordLength 를 보인다",
    bootstrap_rejected: "LoginScreen 이 invalidBootstrapToken·bootstrapRequired 로 login.bootstrap* 문구를 보인다",
    bootstrap_required: "LoginScreen 이 invalidUsername 으로 login.usernameInvalid 를, bootstrapRequired 로 login.bootstrap* 문구를 보인다",
};

/**
 * 리터럴로 풀 수 없는 code 값을 그대로 둬도 되는 곳. 키는 '파일#감싸는 클래스·함수 이름#식' 이다(줄 번호는 코드가 바뀌면 어긋나므로 쓰지 않는다).
 * 검토 M-A: 함수 이름까지 넣어 같은 파일의 다른 곳을 허용하지 않는다. 키 하나는 곳 하나만 허용한다(테스트가 센다).
 * 이름 없는 함수는 'anonymous' 다. 함수를 담은 변수·속성이 있으면 그 이름을 쓴다.
 * 여기 있는 곳은 모두 다른 곳에서 만든 code 를 넘기기만 한다. 그 code 의 리터럴은 만든 곳에서 따로 모인다.
 * 새 곳을 더하려면 code 가 어디서 오는지 적는다. code 를 그 자리에서 정하면 리터럴로 쓴다.
 */
const PASS_THROUGH_SITES: Readonly<Record<string, string>> = {
    // 실패를 만드는 함수의 매개변수. 이 함수를 부르는 곳의 code 인자가 따로 모인다.
    "src/server/admin/AdminServer.ts#AdminServer.route.fail#code": "ctx.fail(status, code, …) 의 구현",
    "src/server/rbac/IdentityTypes.ts#failure#code": "failure(status, code, …) 의 구현",
    "src/server/rbac/IdentityTypes.ts#invalid#code": "invalid(code, …) 가 failure 로 넘기는 값",
    "src/server/rbac/TunnelOwnership.ts#denied#code": "denied(status, code, …) 의 구현",
    // 권한 판정(authorize)의 결과. 판정 값의 code: 리터럴이 따로 모인다.
    "src/server/admin/AdminServer.ts#AdminServer.denyIfUnauthorized.send#decision.code": "권한 판정 결과를 응답한다",
    "src/server/rbac/TunnelOwnership.ts#admitOwner#decision.code": "권한 판정 결과를 터널 거절로 옮긴다",
    // 다른 모듈이 만든 실패 결과. 그 결과의 code: 리터럴이 따로 모인다.
    "src/server/admin/routes.ts#failWith#failure.code": "failWith 가 Failure 를 그대로 응답한다",
    "src/server/admin/blocklistRoutes.ts#blocklistRouteHandlers.onAddSecurityBlock#result.code": "차단 목록 갱신 결과(duplicate·invalid 등)를 응답한다",
    "src/server/admin/passkeyRoutes.ts#passkeyScopeOf#ORIGIN_UNSUPPORTED.code": "같은 파일의 ORIGIN_UNSUPPORTED 객체에 리터럴이 있다",
    // 실패 code 가 아닌 code.
    "src/server/admin/trustedClientRoutes.ts#trustedClientRouteHandlers.onIssueEnrollmentCode#issued.code": "성공 응답의 등록 코드 값",
    "src/server/EnrollmentRegistry.ts#EnrollmentRegistry.issue#code": "발급한 등록 코드 값",
    "src/server/security/countries.ts#listCountries.anonymous#code": "국가 코드",
};

type Site = {code: string; at: string};
type Unresolved = {key: string; at: string};

/** 실패 code 를 받는 함수와 그 인자 위치. failure(status, code, …), invalid(code, …), denied(status, code, …), ctx.fail(status, code, …). */
const CODE_ARGUMENT: Readonly<Record<string, number>> = {failure: 1, invalid: 0, denied: 1, fail: 1};

const stringValue = (node: ts.Node | undefined): string | undefined =>
    node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;

/** node 를 감싸는 가장 가까운 함수. 없으면 파일이다. */
const scopeOf = (node: ts.Node): ts.Node => {
    let current = node.parent;
    while(current !== undefined && !ts.isFunctionLike(current) && !ts.isSourceFile(current)) current = current.parent;
    return current ?? node.getSourceFile();
};

/**
 * code 값의 식을 리터럴 목록으로 푼다. 풀 수 없으면 undefined 다.
 * 리터럴, 조건식의 두 갈래, 같은 함수 안에서 리터럴만 대입하는 지역 변수를 푼다.
 */
const literalsOf = (expression: ts.Expression): string[] | undefined => {
    const literal = stringValue(expression);
    if(literal !== undefined) return [literal];
    if(ts.isParenthesizedExpression(expression)) return literalsOf(expression.expression);
    if(ts.isConditionalExpression(expression)) {
        const whenTrue = literalsOf(expression.whenTrue);
        const whenFalse = literalsOf(expression.whenFalse);
        return whenTrue === undefined || whenFalse === undefined ? undefined : [...whenTrue, ...whenFalse];
    }
    if(ts.isIdentifier(expression)) return localAssignmentsOf(expression);
    return undefined;
};

/** 이름이 node(선언 이름·구조 분해 모양·대입식의 왼쪽) 안에 나오는가. 구조 분해 안의 기본값에 나와도 나온 것으로 본다(보수적). */
const mentions = (node: ts.Node, name: string): boolean =>
    ts.isIdentifier(node) ? node.text === name : ts.forEachChild(node, (child) => mentions(child, name) || undefined) === true;

/** 함수가 이 이름을 자기 것으로 선언하는가(매개변수 또는 함수 안의 변수 선언). 그러면 그 안의 이름은 바깥 변수가 아니다. */
const declaresOwn = (fn: ts.SignatureDeclaration, name: string): boolean => {
    if(fn.parameters.some((parameter) => mentions(parameter.name, name))) return true;
    let found = false;
    const visit = (node: ts.Node): void => {
        if(found || (node !== fn && ts.isFunctionLike(node))) return;
        if(ts.isVariableDeclaration(node) && mentions(node.name, name)) found = true;
        else ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn, visit);
    return found;
};

/**
 * 같은 함수 안에서 이 이름의 지역 변수에 대입하는 값을 모두 푼다. 풀 수 없으면 undefined 다(검토 L-A).
 * 매개변수, 구조 분해로 선언·대입하는 변수, 안쪽 함수가 대입하는 변수는 풀 수 없다. 같은 이름을 새로 선언한 안쪽 함수는 보지 않는다.
 */
const localAssignmentsOf = (name: ts.Identifier): string[] | undefined => {
    const scope = scopeOf(name);
    if(ts.isFunctionLike(scope) && scope.parameters.some((parameter) => mentions(parameter.name, name.text))) return undefined;
    const values: ts.Expression[] = [];
    let declared = false;
    let unknowable = false;
    const visit = (node: ts.Node, nested: boolean): void => {
        if(ts.isFunctionLike(node)) {
            if(!declaresOwn(node, name.text)) ts.forEachChild(node, (child) => visit(child, true));
            return;
        }
        if(ts.isVariableDeclaration(node) && mentions(node.name, name.text)) {
            declared = true;
            if(!ts.isIdentifier(node.name)) unknowable = true;
            else if(node.initializer !== undefined) values.push(node.initializer);
        } else if(ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && mentions(node.left, name.text)) {
            if(nested || !ts.isIdentifier(node.left)) unknowable = true;
            else values.push(node.right);
        }
        ts.forEachChild(node, (child) => visit(child, nested));
    };
    ts.forEachChild(scope, (child) => visit(child, false));
    if(!declared || unknowable || values.length === 0) return undefined;
    const literals: string[] = [];
    for(const value of values) {
        const resolved = literalsOf(value);
        if(resolved === undefined) return undefined;
        literals.push(...resolved);
    }
    return literals;
};

/** 함수의 이름. 이름이 없으면 그 함수를 담은 변수·속성의 이름, 그것도 없으면 'anonymous' 다. */
const functionNameOf = (fn: ts.SignatureDeclaration): string => {
    if(ts.isConstructorDeclaration(fn)) return "constructor";
    if(fn.name !== undefined) return fn.name.getText();
    const holder = fn.parent;
    if((ts.isVariableDeclaration(holder) || ts.isPropertyAssignment(holder) || ts.isPropertyDeclaration(holder)) && holder.initializer === fn) {
        return holder.name.getText();
    }
    return "anonymous";
};

/** node 를 감싸는 클래스와 함수의 이름을 바깥부터 '.' 로 잇는다. 파일 최상위면 '(top)' 이다(검토 M-A). */
const enclosingNameOf = (node: ts.Node): string => {
    const names: string[] = [];
    for(let current = node.parent; current !== undefined && !ts.isSourceFile(current); current = current.parent) {
        if(ts.isFunctionLike(current)) names.unshift(functionNameOf(current));
        else if(ts.isClassLike(current)) names.unshift(current.name?.text ?? "anonymous");
    }
    return names.length === 0 ? "(top)" : names.join(".");
};

/**
 * 한 파일의 소스에서 실패 code 를 모은다. {code: …} 객체(sendApiFailure·deps.fail·결정 값)와 실패를 만드는 함수의 code 인자다.
 * 리터럴로 풀 수 없는 code 값은 unresolved 로 따로 모은다. relative 는 저장소 기준 경로다.
 */
const extractFrom = (relative: string, text: string): {sites: Site[]; unresolved: Unresolved[]} => {
    const sites: Site[] = [];
    const unresolved: Unresolved[] = [];
    const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
    const atOf = (node: ts.Node) => `${relative}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    const collect = (expression: ts.Expression, node: ts.Node) => {
        const codes = literalsOf(expression);
        if(codes === undefined) unresolved.push({key: `${relative}#${enclosingNameOf(node)}#${expression.getText(source)}`, at: atOf(node)});
        else for(const code of codes) sites.push({code, at: atOf(node)});
    };
    const visit = (node: ts.Node): void => {
        if(ts.isPropertyAssignment(node) && node.name.getText(source) === "code") {
            collect(node.initializer, node);
        } else if(ts.isShorthandPropertyAssignment(node) && node.name.text === "code") {
            collect(node.name, node);
        } else if(ts.isCallExpression(node)) {
            const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text
                : ts.isIdentifier(node.expression) ? node.expression.text : "";
            const index = Object.hasOwn(CODE_ARGUMENT, callee) ? CODE_ARGUMENT[callee] : -1;
            const argument = index < 0 ? undefined : node.arguments[index];
            // deps.fail(res, status, {code, …}) 는 객체의 code: 로 모인다. 둘째 인자는 상태 코드다.
            const bodyForm = callee === "fail" && node.arguments.length === 3 && ts.isObjectLiteralExpression(node.arguments[2]);
            if(argument !== undefined && !bodyForm) collect(argument, node);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return {sites, unresolved};
};

/** src/server 의 모든 .ts 에서 실패 code 를 모은다. */
const failureCodeSites = (): {sites: Site[]; unresolved: Unresolved[]} => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if(entry.isDirectory()) return walk(full);
        return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [full] : [];
    });
    const extracted = walk(path.join(root, "src/server"))
        .map((file) => extractFrom(path.relative(root, file).split(path.sep).join("/"), fs.readFileSync(file, "utf8")));
    return {sites: extracted.flatMap((one) => one.sites), unresolved: extracted.flatMap((one) => one.unresolved)};
};

/** 넘김 목록에 없는 풀 수 없는 곳. */
const unlistedOf = (unresolved: Unresolved[]): string[] =>
    unresolved.filter((site) => !Object.hasOwn(PASS_THROUGH_SITES, site.key)).map((site) => `${site.key} (${site.at})`);

/** 실패 code 가 아닌 code 값. 소켓 오류 코드(ETIMEDOUT 등)는 Node 의 오류에 붙이는 값이다. */
const isFailureCode = (code: string) => !/^E[A-Z]+$/.test(code);

describe("FR-7 서버 실패 code 마다 화면 문구가 있다 (검토 M-2)", () => {
    const extracted = failureCodeSites();
    const sites = extracted.sites.filter((site) => isFailureCode(site.code));
    const codes = [...new Set(sites.map((site) => site.code))].sort();
    const english = translator("en");
    /** code 의 화면 문구가 있다. 다른 키의 문구를 쓰는 code(login_failed 등)도 문구가 있는 것이다. */
    const hasText = (code: string) => serverErrorKeyOf(code, english) !== undefined;
    const exempt = (code: string) => Object.hasOwn(UNTRANSLATED_UMBRELLA_CODES, code) || Object.hasOwn(SCREEN_OWNED_CODES, code);

    test("추출이 알려진 모양을 모두 찾는다", () => {
        // sendApiFailure 의 객체, ctx.fail 의 인자, failure()·invalid()·denied() 의 인자, 권한 결정 값.
        // 검토 M-1: 지역 변수(failureCode)와 조건식의 두 갈래도 찾는다.
        for(const expected of ["login_blocked", "CLIENT_EXISTS", "port_not_allowed", "username_invalid", "forbidden", "tunnel_create_forbidden",
            "internal_error", "payload_too_large", "request_timeout", "invalid_json", "bootstrap_password_weak", "bootstrap_rejected"]) {
            expect(codes).toContain(expected);
        }
    });

    test("문구가 없는 code 는 이유를 적은 예외 목록에 있다", () => {
        const missing = codes.filter((code) => !hasText(code) && !exempt(code));
        expect(missing.map((code) => `${code} (${sites.filter((site) => site.code === code).map((site) => site.at).join(", ")})`)).toEqual([]);
    });

    test("예외 목록의 code 는 서버가 실제로 보내고, 문구도 없다", () => {
        const stale = [...Object.keys(UNTRANSLATED_UMBRELLA_CODES), ...Object.keys(SCREEN_OWNED_CODES)]
            .filter((code) => !codes.includes(code) || hasText(code));
        expect(stale).toEqual([]);
    });

    test("리터럴로 풀 수 없는 code 값은 이유를 적은 넘김 목록에 있다", () => {
        expect(unlistedOf(extracted.unresolved)).toEqual([]);
    });

    test("넘김 목록의 키 하나는 곳 하나만 허용한다 (검토 M-A)", () => {
        const shared = Object.keys(PASS_THROUGH_SITES)
            .map((key) => ({key, count: extracted.unresolved.filter((site) => site.key === key).length}))
            .filter(({count}) => count > 1);
        expect(shared).toEqual([]);
    });

    test("넘김 목록의 곳은 아직 코드에 있다", () => {
        const stale = Object.keys(PASS_THROUGH_SITES).filter((key) => !extracted.unresolved.some((site) => site.key === key));
        expect(stale).toEqual([]);
    });
});

// 검토 M-A: 넘김 목록은 파일 전체가 아니라 그 함수의 곳만 허용한다. 같은 파일에 새로 풀 수 없는 곳이 생기면 잡아야 한다.
describe("넘김 목록의 범위 (검토 M-A)", () => {
    test("같은 파일의 다른 함수에서 생긴 풀 수 없는 code 는 넘김 목록이 허용하지 않는다", () => {
        const text = [
            "class AdminServer {",
            "    route(res) { const ctx = {fail: (status, code, message) => this.sendApiFailure(res, status, {code, message})}; }",
            "    other(ctx, reason) { ctx.fail(400, reason.code, 'x'); ctx.fail(400, code, 'y'); }",
            "}",
        ].join("\n");
        const {unresolved} = extractFrom("src/server/admin/AdminServer.ts", text);
        expect(unresolved).toHaveLength(3);
        expect(unlistedOf(unresolved)).toHaveLength(2);
    });
});

// 검토 L-A: 지역 변수를 풀 때 안쪽 함수의 선언은 보지 않고, 매개변수와 구조 분해 대입은 풀 수 없는 값으로 본다.
describe("code 식을 리터럴로 푸는 규칙 (검토 L-A)", () => {
    const codesOf = (body: string) => {
        const {sites, unresolved} = extractFrom("src/server/sample.ts", `function send(ctx, input, ok) { ${body} }`);
        return {codes: sites.map((site) => site.code), unresolved: unresolved.length};
    };

    test("조건식의 두 갈래를 푼다", () => {
        expect(codesOf("ctx.fail(400, ok ? 'a' : 'b', 'm');")).toEqual({codes: ["a", "b"], unresolved: 0});
    });

    test("리터럴만 대입하는 지역 변수를 푼다", () => {
        expect(codesOf("let code = 'a'; if(ok) code = 'b'; ctx.fail(400, code, 'm');")).toEqual({codes: ["a", "b"], unresolved: 0});
    });

    test("안쪽 함수가 같은 이름을 새로 선언하면 바깥 변수의 값에 넣지 않는다", () => {
        expect(codesOf("const code = 'a'; const inner = () => { const code = input.code; return code; }; ctx.fail(400, code, 'm');"))
            .toEqual({codes: ["a"], unresolved: 0});
    });

    test("매개변수는 안쪽 함수에 같은 이름의 선언이 있어도 풀 수 없다", () => {
        const {sites, unresolved} = extractFrom("src/server/sample.ts",
            "function send(ctx, code) { const inner = () => { const code = 'a'; return code; }; ctx.fail(400, code, 'm'); }");
        expect({codes: sites.map((site) => site.code), unresolved: unresolved.length}).toEqual({codes: [], unresolved: 1});
    });

    test("안쪽 함수가 바깥 변수에 대입하면 풀 수 없다", () => {
        expect(codesOf("let code = 'a'; const inner = () => { code = input.code; }; inner(); ctx.fail(400, code, 'm');"))
            .toEqual({codes: [], unresolved: 1});
    });

    test("구조 분해 대입은 풀 수 없다", () => {
        // 왼쪽의 {code} 는 {code: …} 객체로 모이므로, 이 검사는 다른 이름을 쓴다.
        expect(codesOf("let failureCode = 'a'; ({failureCode} = input); ctx.fail(400, failureCode, 'm');")).toEqual({codes: [], unresolved: 1});
        expect(codesOf("let code = 'a'; [code] = input.codes; ctx.fail(400, code, 'm');")).toEqual({codes: [], unresolved: 1});
    });
});
