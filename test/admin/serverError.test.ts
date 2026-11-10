import {errorMessageOf} from "../../admin/src/i18n/serverError";
import {translator, type MessageKey, type Params, type Translator} from "../../admin/src/i18n";

// 이슈 349 FR-7·AC-4 — 서버 오류를 응답의 code 로 번역하는 하나의 함수.
// 옛 tunnelPolicy.tunnelErrorMessage, MeScreen 의 PASSKEY_ERRORS, LoginScreen 의 passkeyFailureOf 를 대신한다.
describe("errorMessageOf", () => {
    const en = translator("en");
    const ko = translator("ko");

    test("알려진 code 는 그 언어의 문구다 (AC-4)", () => {
        const result = {success: false, code: "port_not_allowed", message: "server text"};
        expect(errorMessageOf(result, "fallback", en)).toBe("This port is outside your group's allowed ranges.");
        expect(errorMessageOf(result, "fallback", ko)).toBe("이 포트는 그룹에 허용된 범위 밖에 있습니다.");
    });

    test("문구에 들어가는 값은 응답의 별도 필드에서 받는다", () => {
        const result = {success: false, code: "passkey_limit", limit: 20, message: "server text"};
        expect(errorMessageOf(result, "fallback", en)).toBe("You can register up to 20 passkeys.");
        expect(errorMessageOf(result, "fallback", ko)).toBe("패스키는 20개까지 등록할 수 있습니다.");
    });

    test("값 필드가 없으면(옛 서버) 서버 문구를 보인다", () => {
        expect(errorMessageOf({code: "passkey_limit", message: "You can register up to 20 passkeys."}, "fallback", ko))
            .toBe("You can register up to 20 passkeys.");
    });

    test("번역 맵에 없는 code 는 서버 문구를 그대로 보인다 (AC-4)", () => {
        expect(errorMessageOf({code: "unknown_code", message: "server says"}, "fallback", ko)).toBe("server says");
        expect(errorMessageOf({message: "server says"}, "fallback", ko)).toBe("server says");
    });

    test("서버 문구가 없거나 화면이 만든 문구면 fallback 이다", () => {
        expect(errorMessageOf({code: "unknown_code", message: ""}, "fallback", en)).toBe("fallback");
        expect(errorMessageOf({message: "Admin network request failed: x", generated: true}, "fallback", en)).toBe("fallback");
        expect(errorMessageOf({}, "fallback", en)).toBe("fallback");
    });

    test("Object 의 속성 이름은 code 로 보지 않는다", () => {
        expect(errorMessageOf({code: "toString", message: ""}, "fallback", en)).toBe("fallback");
        expect(errorMessageOf({code: "constructor", message: "server"}, "fallback", en)).toBe("server");
    });

    test.each([
        ["port_not_allowed", "This port is outside your group's allowed ranges."],
        ["protocol_not_allowed", "This protocol is not allowed for your group."],
        ["rewrite_not_allowed", "HTTP rewrite options are not allowed for your group."],
        ["trusted_client_not_allowed", "One of the selected trusted clients is not allowed for your group."],
        ["tunnel_count_exceeded", "You have reached your tunnel limit."],
        ["buffer_limit_exceeded", "The server buffer is larger than the server's memory cache limit."],
        ["password_incorrect", "The password is incorrect."],
        ["passkey_already_registered", "This device already has a passkey for this account."],
        ["passkey_registration_expired", "The setup expired. Try again."],
        ["passkey_name_invalid", "Enter a name of 1 to 64 characters."],
        ["passkey_invalid", "The passkey was not accepted."],
        ["passkey_origin_unsupported", "Passkeys need a domain name with a trusted HTTPS certificate, or localhost. This address can't use them."],
        ["passkey_unavailable", "Sign in with your password first."],
        ["passkey_busy", "The server is busy. Try again in a minute."],
    ])("영어 문구는 옛 맵과 같다: %s", (code, expected) => {
        expect(errorMessageOf({code, message: "server text"}, "fallback", en)).toBe(expected);
    });
});

describe("errorMessageOf — 배열 값 (이슈 349 FR-7)", () => {
    // 배열 값을 쓰는 code 의 문구가 아직 리소스에 없으므로, 그런 문구를 가진 Translator 로 확인한다.
    const withTemplate = (base: Translator): Translator => ({
        ...base,
        has: (key: string): key is MessageKey => key === "serverError.port_in_use" || base.has(key),
        t: (key: MessageKey, params?: Params) => key === ("serverError.port_in_use" as MessageKey)
            ? `ports: ${params?.ports ?? "{ports}"}` : base.t(key, params),
    });

    test("문자열·숫자 배열은 그 언어의 목록 표기로 끼운다", () => {
        const result = {success: false, code: "port_in_use", message: "Port number 8080,8443 is already in use", ports: [8080, 8443]};
        expect(errorMessageOf(result, "fallback", withTemplate(translator("en")))).toBe("ports: 8080 and 8443");
        expect(errorMessageOf(result, "fallback", withTemplate(translator("ko")))).toBe("ports: 8080 및 8443");
    });

    test("빈 배열은 값으로 쓰지 않으므로 서버 문구를 보인다", () => {
        const result = {code: "port_in_use", message: "server text", ports: []};
        expect(errorMessageOf(result, "fallback", withTemplate(translator("en")))).toBe("server text");
    });

    test("객체가 섞인 배열은 값으로 쓰지 않으므로 서버 문구를 보인다", () => {
        const result = {code: "port_in_use", message: "server text", ports: [{port: 8080}]};
        expect(errorMessageOf(result, "fallback", withTemplate(translator("en")))).toBe("server text");
    });
});

// 이슈 349 2단계 — fallback 을 생략하면 실패 값의 문구다. AdminRequest 가 만든 문구(네트워크 실패 등)도 그대로 보인다.
describe("errorMessageOf 의 기본 fallback", () => {
    const en = translator("en");
    const ko = translator("ko");

    test("생략하면 실패 값의 문구다", () => {
        expect(errorMessageOf({message: "Admin network request failed: x", generated: true})).toBe("Admin network request failed: x");
        expect(errorMessageOf({code: "unknown_code", message: "server says"})).toBe("server says");
        expect(errorMessageOf({})).toBe("");
    });

    test("알려진 code 는 생략해도 번역한다", () => {
        expect(errorMessageOf({code: "login_blocked", message: "Too many login attempts"}, undefined, ko)).toBe("로그인 시도가 너무 많습니다.");
        expect(errorMessageOf({code: "login_blocked", message: "Too many login attempts"}, undefined, en)).toBe("Too many login attempts");
    });
});

// 2단계에서 더한 code 의 영어 문구는 지금 영어 화면에 보이는 문구와 같다(AC-6). 대개 서버 문구이고, 화면이 code 로 따로 고르던
// 문구(username_taken·last_superuser·user_owns_tunnels·group_not_empty·group_revision_conflict·mfa_enrollment_expired·mfa_required)는 그 문구다.
// 값이 들어가는 문구는 응답의 값 필드로 같은 문구를 만든다.
describe("이슈 349 2단계 서버 오류 code", () => {
    const en = translator("en");
    const ko = translator("ko");

    test.each([
        [{code: "invalid_session"}, "Invalid session", "세션이 유효하지 않습니다."],
        [{code: "login_blocked"}, "Too many login attempts", "로그인 시도가 너무 많습니다."],
        [{code: "login_concurrency_limit"}, "Too many login attempts", "로그인 시도가 너무 많습니다."],
        [{code: "csrf_token_missing"}, "Missing CSRF token", "CSRF 토큰이 없습니다."],
        [{code: "csrf_token_mismatch"}, "CSRF token mismatch", "CSRF 토큰이 맞지 않습니다."],
        [{code: "forbidden_origin"}, "Forbidden origin", "허용되지 않은 출처입니다."],
        [{code: "configuration_changed"}, "Configuration changed. Reload before saving.", "설정이 바뀌었습니다. 저장하기 전에 다시 불러오세요."],
        [{code: "certificate_changed"}, "Certificate changed. Reload before saving.", "인증서가 바뀌었습니다. 저장하기 전에 다시 불러오세요."],
        [{code: "port_in_use", ports: [8080]}, "Port number 8080 is already in use", "이미 사용 중인 포트입니다: 8080"],
        [{code: "port_unusable", forwardPort: 70000}, "70000 is an unusable port number.", "쓸 수 없는 포트 번호입니다: 70000"],
        [{code: "listener_stop_failed", forwardPort: 8080}, "Unable to stop external port(8080) listener.", "외부 포트 8080의 리스너를 멈추지 못했습니다."],
        [{code: "username_taken", username: "alice"}, "That username is already in use.", "이미 사용 중인 사용자 이름입니다."],
        [{code: "last_superuser"}, "At least one active superuser must remain.", "활성 슈퍼유저가 적어도 한 명은 있어야 합니다."],
        [{code: "user_owns_tunnels", ports: [8080]}, "Reassign this user's tunnels first.", "먼저 이 사용자의 터널을 다른 사용자에게 넘기세요."],
        [{code: "group_not_empty", groupId: "g_1"}, "Move the members to another group first.", "먼저 구성원을 다른 그룹으로 옮기세요."],
        [{code: "group_revision_conflict"}, "Someone else changed this group. Reload to see the latest values.", "다른 사람이 이 그룹을 바꿨습니다. 다시 불러와 최신 값을 확인하세요."],
        [{code: "CLIENT_EXISTS", clientId: "edge"}, "trusted client 'edge' already exists", "이미 있는 신뢰 클라이언트입니다: edge"],
        [{code: "mfa_code_invalid"}, "The code is incorrect.", "코드가 틀렸습니다."],
        [{code: "mfa_ticket_invalid"}, "The sign-in expired. Start again.", "로그인 시간이 지났습니다. 처음부터 다시 하세요."],
        [{code: "session_not_found"}, "Session not found", "세션을 찾을 수 없습니다."],
        [{code: "mfa_enrollment_required"}, "Enable two-factor authentication first.", "먼저 2단계 인증을 켜세요."],
        [{code: "full", max: 1000}, "the blocklist already has 1000 entries", "차단 목록이 가득 찼습니다(최대 1000개)."],
    ] as Array<[Record<string, unknown>, string, string]>)("%j", (result, english, korean) => {
        expect(errorMessageOf({...result, message: "server text"}, "fallback", en)).toBe(english);
        expect(errorMessageOf({...result, message: "server text"}, "fallback", ko)).toBe(korean);
    });

    test("여러 문구를 쓰는 code(not_found 등)는 번역하지 않고 서버 문구를 보인다", () => {
        for(const code of ["not_found", "tunnel_apply_failed", "user_not_found", "group_not_found", "forbidden", "invalid", "duplicate"]) {
            expect(errorMessageOf({code, message: "server text"}, "fallback", ko)).toBe("server text");
        }
    });
});
