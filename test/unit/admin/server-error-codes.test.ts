import fs from "fs";
import path from "path";
import ts from "typescript";
import {en} from "../../../admin/src/i18n/en";

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

type Site = {code: string; at: string};

/** 실패 code 를 받는 함수와 그 인자 위치. failure(status, code, …), invalid(code, …), denied(status, code, …), ctx.fail(status, code, …). */
const CODE_ARGUMENT: Readonly<Record<string, number>> = {failure: 1, invalid: 0, denied: 1, fail: 1};

const stringValue = (node: ts.Node | undefined): string | undefined =>
    node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;

/** src/server 의 .ts 에서 실패 code 리터럴을 모은다. {code: '…'} 객체(sendApiFailure·deps.fail·결정 값)와 실패를 만드는 함수의 code 인자다. */
const failureCodeSites = (): Site[] => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if(entry.isDirectory()) return walk(full);
        return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [full] : [];
    });
    const sites: Site[] = [];
    for(const file of walk(path.join(root, "src/server"))) {
        const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
        const add = (code: string, node: ts.Node) => {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            sites.push({code, at: `${path.relative(root, file).split(path.sep).join("/")}:${line}`});
        };
        const visit = (node: ts.Node): void => {
            if(ts.isPropertyAssignment(node) && node.name.getText(source) === "code") {
                const code = stringValue(node.initializer);
                if(code !== undefined) add(code, node);
            } else if(ts.isCallExpression(node)) {
                const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text
                    : ts.isIdentifier(node.expression) ? node.expression.text : "";
                const index = Object.hasOwn(CODE_ARGUMENT, callee) ? CODE_ARGUMENT[callee] : -1;
                const code = index < 0 ? undefined : stringValue(node.arguments[index]);
                if(code !== undefined) add(code, node);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return sites;
};

/** 실패 code 가 아닌 code 값. 소켓 오류 코드(ETIMEDOUT 등)는 Node 의 오류에 붙이는 값이다. */
const isFailureCode = (code: string) => !/^E[A-Z]+$/.test(code);

describe("FR-7 서버 실패 code 마다 화면 문구가 있다 (검토 M-2)", () => {
    const sites = failureCodeSites().filter((site) => isFailureCode(site.code));
    const codes = [...new Set(sites.map((site) => site.code))].sort();

    test("추출이 알려진 모양을 모두 찾는다", () => {
        // sendApiFailure 의 객체, ctx.fail 의 인자, failure()·invalid()·denied() 의 인자, 권한 결정 값.
        for(const expected of ["login_blocked", "CLIENT_EXISTS", "port_not_allowed", "username_invalid", "forbidden", "tunnel_create_forbidden"]) {
            expect(codes).toContain(expected);
        }
    });

    test("문구가 없는 code 는 이유를 적은 예외 목록에 있다", () => {
        const missing = codes.filter((code) => !Object.hasOwn(en, `serverError.${code}`) && !Object.hasOwn(UNTRANSLATED_UMBRELLA_CODES, code));
        expect(missing.map((code) => `${code} (${sites.filter((site) => site.code === code).map((site) => site.at).join(", ")})`)).toEqual([]);
    });

    test("예외 목록의 code 는 서버가 실제로 보내고, 문구도 없다", () => {
        const stale = Object.keys(UNTRANSLATED_UMBRELLA_CODES).filter((code) => !codes.includes(code) || Object.hasOwn(en, `serverError.${code}`));
        expect(stale).toEqual([]);
    });
});
