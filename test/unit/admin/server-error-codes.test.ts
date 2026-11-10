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
 * 이 응답에는 서버 문구(message)도 없다. 그래서 serverError.<code> 문구를 두지 않는다.
 */
const SCREEN_OWNED_CODES: Readonly<Record<string, string>> = {
    bootstrap_password_weak: "LoginScreen 이 weakPassword 로 login.passwordLength 를 보인다",
    bootstrap_rejected: "LoginScreen 이 invalidBootstrapToken·bootstrapRequired 로 login.bootstrap* 문구를 보인다",
};

/**
 * 리터럴로 풀 수 없는 code 값을 그대로 둬도 되는 곳. 키는 '파일#식' 이다(줄 번호는 코드가 바뀌면 어긋나므로 쓰지 않는다).
 * 여기 있는 곳은 모두 다른 곳에서 만든 code 를 넘기기만 한다. 그 code 의 리터럴은 만든 곳에서 따로 모인다.
 * 새 곳을 더하려면 code 가 어디서 오는지 적는다. code 를 그 자리에서 정하면 리터럴로 쓴다.
 */
const PASS_THROUGH_SITES: Readonly<Record<string, string>> = {
    // 실패를 만드는 함수의 매개변수. 이 함수를 부르는 곳의 code 인자가 따로 모인다.
    "src/server/admin/AdminServer.ts#code": "ctx.fail(status, code, …) 의 구현",
    "src/server/rbac/IdentityTypes.ts#code": "failure(status, code, …) 의 구현과 invalid(code, …) 가 failure 로 넘기는 값",
    "src/server/rbac/TunnelOwnership.ts#code": "denied(status, code, …) 의 구현",
    // 권한 판정(authorize)의 결과. 판정 값의 code: 리터럴이 따로 모인다.
    "src/server/admin/AdminServer.ts#decision.code": "권한 판정 결과를 응답한다",
    "src/server/rbac/TunnelOwnership.ts#decision.code": "권한 판정 결과를 터널 거절로 옮긴다",
    // 다른 모듈이 만든 실패 결과. 그 결과의 code: 리터럴이 따로 모인다.
    "src/server/admin/routes.ts#failure.code": "failWith 가 Failure 를 그대로 응답한다",
    "src/server/admin/blocklistRoutes.ts#result.code": "차단 목록 갱신 결과(duplicate·invalid 등)를 응답한다",
    "src/server/admin/passkeyRoutes.ts#ORIGIN_UNSUPPORTED.code": "같은 파일의 ORIGIN_UNSUPPORTED 객체에 리터럴이 있다",
    // 실패 code 가 아닌 code.
    "src/server/admin/trustedClientRoutes.ts#issued.code": "성공 응답의 등록 코드 값",
    "src/server/EnrollmentRegistry.ts#code": "발급한 등록 코드 값",
    "src/server/security/countries.ts#code": "국가 코드",
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

/** 같은 함수 안에서 이 이름의 지역 변수에 대입하는 값을 모두 푼다. 매개변수이거나 대입 값 하나라도 풀 수 없으면 undefined 다. */
const localAssignmentsOf = (name: ts.Identifier): string[] | undefined => {
    const scope = scopeOf(name);
    const values: ts.Expression[] = [];
    let declared = false;
    const visit = (node: ts.Node): void => {
        if(ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name.text) {
            declared = true;
            if(node.initializer !== undefined) values.push(node.initializer);
        } else if(ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isIdentifier(node.left) && node.left.text === name.text) {
            values.push(node.right);
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(scope, visit);
    if(!declared || values.length === 0) return undefined;
    const literals: string[] = [];
    for(const value of values) {
        const resolved = literalsOf(value);
        if(resolved === undefined) return undefined;
        literals.push(...resolved);
    }
    return literals;
};

/**
 * src/server 의 .ts 에서 실패 code 를 모은다. {code: …} 객체(sendApiFailure·deps.fail·결정 값)와 실패를 만드는 함수의 code 인자다.
 * 리터럴로 풀 수 없는 code 값은 unresolved 로 따로 모은다.
 */
const failureCodeSites = (): {sites: Site[]; unresolved: Unresolved[]} => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if(entry.isDirectory()) return walk(full);
        return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [full] : [];
    });
    const sites: Site[] = [];
    const unresolved: Unresolved[] = [];
    for(const file of walk(path.join(root, "src/server"))) {
        const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
        const relative = path.relative(root, file).split(path.sep).join("/");
        const atOf = (node: ts.Node) => `${relative}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
        const collect = (expression: ts.Expression, node: ts.Node) => {
            const codes = literalsOf(expression);
            if(codes === undefined) unresolved.push({key: `${relative}#${expression.getText(source)}`, at: atOf(node)});
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
    }
    return {sites, unresolved};
};

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
        const unknown = extracted.unresolved.filter((site) => !Object.hasOwn(PASS_THROUGH_SITES, site.key));
        expect(unknown.map((site) => `${site.key} (${site.at})`)).toEqual([]);
    });

    test("넘김 목록의 곳은 아직 코드에 있다", () => {
        const stale = Object.keys(PASS_THROUGH_SITES).filter((key) => !extracted.unresolved.some((site) => site.key === key));
        expect(stale).toEqual([]);
    });
});
