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
