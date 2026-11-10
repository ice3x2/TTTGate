import InvalidSession from "./InvalidSession";
import {t} from "../i18n";

// 이슈 338: generated 는 서버가 보낸 문구가 아니라 이 파일이 만든 문구라는 표시다(serverMessageOf 가 본다).
const failure = (message: string, status = 0) => ({success: false, status, message, generated: true});

/** 실패 값의 서버 문구. 이 파일이 만든 문구(네트워크 실패, 문구 없는 HTTP 오류)면 빈 문자열이다. 화면은 그때 자기 문구를 쓴다. */
export const serverMessageOf = (result: {message?: string; generated?: boolean}): string =>
    result.generated === true ? '' : (result.message ?? '');
const csrfCookie = (): string => {
    const entry = document.cookie.split(";").map((part) => part.trim())
        .find((part) => part.startsWith("csrfToken="));
    return entry ? entry.slice("csrfToken=".length) : "";
};

// U4-09: 세션 안에서 비밀번호·코드를 다시 확인하는 요청의 401 은 세션 만료가 아니다. 이 코드가 붙은 401 만 실패 값으로 돌려준다.
const CREDENTIAL_CHECK_CODES = ['password_incorrect', 'mfa_code_invalid'];

const requestJson = async (url: URL, options: RequestInit, credentialCheck = false): Promise<any> => {
    let response: Response;
    try {
        response = await fetch(url.href, {...options, credentials: "same-origin", redirect: "error"});
    } catch(error) {
        return failure(t("request.networkFailed", {reason: error instanceof Error ? error.message : String(error)}));
    }
    if(response.status === 401 && credentialCheck) {
        const value = await response.json().catch(() => undefined);
        if(value && CREDENTIAL_CHECK_CODES.includes(value.code)) {
            return {...value, success: false, status: 401, message: typeof value.message === "string" ? value.message : ""};
        }
        throw new InvalidSession();
    }
    if(response.status === 401) throw new InvalidSession();
    let value: any;
    try {
        value = await response.json();
    } catch {
        return failure(t("request.invalidJson", {status: response.status}), response.status);
    }
    if(!value || typeof value !== "object" || Array.isArray(value) || (response.ok && typeof value.success !== "boolean")) {
        return failure(t("request.invalidJson", {status: response.status}), response.status);
    }
    if(!response.ok) {
        if(response.status === 403 && value.code === "mfa_enrollment_required") enrollmentRequired?.();
        const fromServer = typeof value.message === "string" && value.message !== "";
        return {...value, success: false, status: response.status,
            message: fromServer ? value.message : t("request.httpFailed", {status: response.status}), ...(fromServer ? {} : {generated: true})};
    }
    return value;
};

/**
 * 이슈 346: 서버가 403 mfa_enrollment_required 로 거절했을 때 부를 함수. 로그인한 사이에 2단계 인증 강제가 켜진 경우다.
 * 앱이 하나를 등록해 내 정보를 다시 읽고 등록 화면으로 옮긴다. 이 파일은 화면 상태를 모르므로 함수만 부른다.
 */
let enrollmentRequired: (() => void) | undefined;
export const onMfaEnrollmentRequired = (listener: (() => void) | undefined): void => { enrollmentRequired = listener; };

let csrfRecovery: Promise<any> | undefined;

/** extra.credentialCheck: 비밀번호·코드 재확인 요청이다(401 password_incorrect·mfa_code_invalid 를 실패 값으로 돌려준다). */
export const adminRequest = async (path: string, options: RequestInit = {}, extra: {credentialCheck?: boolean} = {}): Promise<any> => {
    const url = new URL(path, window.location.href);
    if(url.origin !== window.location.origin) return failure(t("request.crossOrigin"));
    const method = (options.method ?? "GET").toUpperCase();
    const headers = new Headers(options.headers);
    if(!["GET", "HEAD", "OPTIONS"].includes(method)) {
        let token = csrfCookie();
        if(!token) {
            // Share only token recovery; each caller sends its mutation once.
            if(!csrfRecovery) {
                csrfRecovery = requestJson(new URL("/api/csrfToken", window.location.origin), {method: "GET"})
                    .finally(() => { csrfRecovery = undefined; });
            }
            const restored = await csrfRecovery;
            if(restored.success !== true) return restored;
            token = csrfCookie();
            if(!token) return failure(t("request.csrfNotRestored"));
        }
        headers.set("X-CSRF-Token", token);
    }
    return requestJson(url, {...options, method, headers}, extra.credentialCheck === true);
};
