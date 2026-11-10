import {errorMessageOf, serverErrorKeyOf} from "../../admin/src/i18n/serverError";
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

    // 검토 L-C: 화면이 넘긴 fallback 은 문자열을 비교해 바꾸지 않고 그대로 보인다. 일반 문구가 필요한 화면은 fallback 을 생략한다.
    test("서버가 응답했어도(status > 0) 화면이 넘긴 fallback 은 그대로 둔다 (검토 M-2)", () => {
        expect(errorMessageOf({message: "Admin request failed (HTTP 500)", generated: true, status: 500}, "Unable to change tunnel 'web'.", en))
            .toBe("Unable to change tunnel 'web'.");
        expect(errorMessageOf({message: "Admin request failed (HTTP 500)", generated: true, status: 500}, en.t("tunnelStatus.timeLimitFailed"), en))
            .toBe(en.t("tunnelStatus.timeLimitFailed"));
        expect(errorMessageOf({message: "Admin request failed (HTTP 500)", generated: true, status: 500}, en.t("common.unableToConnect"), en))
            .toBe(en.t("common.unableToConnect"));
    });

    test("서버에 닿지 못했으면(status 0) fallback 이다", () => {
        expect(errorMessageOf({message: "Admin network request failed: x", generated: true, status: 0}, "fallback", en)).toBe("fallback");
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

// 검토 M-2: 새로 문구를 둔 code 는 영어 화면이 지금과 같다. 영어 문구가 서버가 보내는 문구와 같다.
describe("errorMessageOf — 서버 문구가 한 가지인 code 의 영어 문구는 서버 문구와 같다", () => {
    const en = translator("en");
    const ko = translator("ko");

    test.each([
        ["login_failed", {}, "The password is incorrect."],
        ["INVALID_DISPLAY_NAME", {max: 128}, "displayName must be 1-128 characters"],
        ["INVALID_TTL", {max: 43200}, "ttlMinutes must be null (no expiry) or an integer within 1..43200"],
        ["password_too_long", {max: 1024}, "password must be at most 1024 characters"],
        ["query_invalid", {min: 2, max: 64}, "q must be 2 to 64 characters"],
        ["role_invalid", {roles: ["superuser", "regular"]}, "role must be one of superuser, regular"],
        ["status_invalid", {statuses: ["active", "disabled"]}, "status must be one of active, disabled"],
        ["shared_users_too_many", {max: 50}, "a tunnel can be shared with at most 50 users"],
        ["shared_user_not_found", {userId: "u-1"}, "shared user not found: u-1"],
        ["attributes_unknown_key", {key: "color"}, "unknown group attribute: color"],
        ["attribute_bool_invalid", {attribute: "mfa_required", value: "yes"}, "invalid mfa_required: yes"],
        ["TRUSTED_CLIENTS_READ_ONLY", {}, "trustedClients cannot be changed with the server option. Use /api/trustedClients."],
        // 검토 M-1: 관리 서버가 요청을 처리하다 실패했을 때 지역 변수(failureCode)로 보내는 code.
        ["internal_error", {}, "Internal Server Error"],
        ["payload_too_large", {}, "Payload Too Large"],
        ["request_timeout", {}, "Request Timeout"],
        ["invalid_json", {}, "Invalid JSON body"],
    ] as Array<[string, Record<string, unknown>, string]>)("%s", (code, values, serverText) => {
        const result = {success: false, code, message: serverText, ...values};
        expect(errorMessageOf(result, "fallback", en)).toBe(serverText);
        expect(errorMessageOf(result, "fallback", ko)).not.toBe(serverText);
    });

    test("한국어 문구", () => {
        expect(errorMessageOf({code: "login_failed"}, "fallback", ko)).toBe("비밀번호가 틀렸습니다.");
        expect(errorMessageOf({code: "shared_users_too_many", max: 50, message: "x"}, "fallback", ko)).toBe("터널은 최대 50명에게 공유할 수 있습니다.");
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

// 이슈 349 검토 L-C — fallback 을 생략하면 일반 문구다. 서버가 응답했으면(status > 0) AdminRequest 가 만든 HTTP 상태 문구,
// 서버에 닿지 못했거나 보일 문구가 없으면 '서버에 연결하지 못했다' 다. 예외 원문(Failed to fetch 등)은 보이지 않는다(검토 H-1).
describe("errorMessageOf 의 기본 fallback", () => {
    const en = translator("en");
    const ko = translator("ko");

    test("생략하면(status > 0) AdminRequest 가 만든 HTTP 상태 문구다", () => {
        expect(errorMessageOf({message: "Admin request failed (HTTP 500)", generated: true, status: 500}, undefined, en)).toBe("Admin request failed (HTTP 500)");
        expect(errorMessageOf({message: "관리 서버의 응답이 올바른 JSON이 아닙니다(HTTP 502).", generated: true, status: 502}, undefined, ko))
            .toBe("관리 서버의 응답이 올바른 JSON이 아닙니다(HTTP 502).");
    });

    test("생략하면(status 0) 예외 원문 대신 연결 실패 문구다", () => {
        expect(errorMessageOf({message: "Admin network request failed: Failed to fetch", generated: true, status: 0}, undefined, en))
            .toBe(en.t("common.unableToConnect"));
        expect(errorMessageOf({message: "관리 서버에 연결하지 못했습니다: Failed to fetch", generated: true, status: 0}, undefined, ko))
            .toBe(ko.t("common.unableToConnect"));
    });

    test("생략했는데 보일 문구가 없으면 연결 실패 문구다", () => {
        expect(errorMessageOf({}, undefined, en)).toBe(en.t("common.unableToConnect"));
        expect(errorMessageOf({code: "unknown_code", message: "", status: 403}, undefined, ko)).toBe(ko.t("common.unableToConnect"));
    });

    test("생략해도 서버 문구는 그대로 보인다", () => {
        expect(errorMessageOf({code: "unknown_code", message: "server says"}, undefined, en)).toBe("server says");
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

// 검토 L-3: 같은 문구를 두 키에 두지 않는다. login_failed 는 password_incorrect 의 문구를 쓴다.
describe("errorMessageOf — 다른 키의 문구를 쓰는 code", () => {
    const en = translator("en");
    const ko = translator("ko");

    test.each([
        ["login_failed", "The password is incorrect.", "비밀번호가 틀렸습니다."],
    ])("%s", (code, english, korean) => {
        expect(errorMessageOf({code, message: "server text"}, "fallback", en)).toBe(english);
        expect(errorMessageOf({code, message: "server text"}, "fallback", ko)).toBe(korean);
    });

    test("같은 문구를 담은 키를 따로 두지 않는다", () => {
        expect(en.has("serverError.login_failed")).toBe(false);
        expect(en.has("serverError.bootstrap_required")).toBe(false);
    });

    // 검토 L-B: bootstrap_required 는 bootstrap_password_weak·bootstrap_rejected 처럼 LoginScreen 이 응답의 플래그로 자기 문구를 고른다.
    test("bootstrap_required 는 화면이 정하는 code 라 문구 키가 없다", () => {
        expect(serverErrorKeyOf("bootstrap_required", en)).toBeUndefined();
        expect(errorMessageOf({code: "bootstrap_required", message: "server text"}, "fallback", ko)).toBe("server text");
    });

    test("serverErrorKeyOf 는 code 가 쓰는 문구 키다", () => {
        expect(serverErrorKeyOf("login_failed", en)).toBe("serverError.password_incorrect");
        expect(serverErrorKeyOf("port_not_allowed", en)).toBe("serverError.port_not_allowed");
        expect(serverErrorKeyOf("unknown_code", en)).toBeUndefined();
        expect(serverErrorKeyOf("toString", en)).toBeUndefined();
    });
});

// 검토 L-5: 한국어 문구는 자연스럽게 쓰고, 유효 시간의 단위(분)를 밝힌다. 서버의 ttlMinutes 는 분 단위다.
describe("errorMessageOf — 한국어 문구", () => {
    const ko = translator("ko");

    test.each([
        [{code: "expected_revision_invalid"}, "expectedRevision 값은 1 이상의 정수여야 합니다."],
        [{code: "expected_certificate_revision_invalid"}, "expectedCertificateRevision 값은 1 이상의 정수여야 합니다."],
        [{code: "INVALID_TTL", max: 43200}, "유효 시간(ttlMinutes)은 만료 없음(null)이거나 1~43200분 사이의 정수여야 합니다."],
        // 검토 L-D: '시간이 지났다' 는 남은 시간이 끝났다는 뜻으로 읽힌다. 요청이 제한 시간 안에 끝나지 않았다고 쓴다.
        [{code: "request_timeout"}, "요청이 제한 시간 안에 끝나지 않았습니다."],
    ] as Array<[Record<string, unknown>, string]>)("%j", (result, korean) => {
        expect(errorMessageOf({...result, message: "server text"}, "fallback", ko)).toBe(korean);
    });
});
