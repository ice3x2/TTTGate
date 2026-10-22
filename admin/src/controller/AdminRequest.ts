import InvalidSession from "./InvalidSession";

const failure = (message: string, status = 0) => ({success: false, status, message});
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
        return failure(`Admin network request failed: ${error instanceof Error ? error.message : String(error)}`);
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
        return failure(`Invalid JSON response from admin server (HTTP ${response.status})`, response.status);
    }
    if(!value || typeof value !== "object" || Array.isArray(value) || (response.ok && typeof value.success !== "boolean")) {
        return failure(`Invalid JSON response from admin server (HTTP ${response.status})`, response.status);
    }
    if(!response.ok) {
        return {...value, success: false, status: response.status,
            message: typeof value.message === "string" && value.message ? value.message : `Admin request failed (HTTP ${response.status})`};
    }
    return value;
};

let csrfRecovery: Promise<any> | undefined;

/** extra.credentialCheck: 비밀번호·코드 재확인 요청이다(401 password_incorrect·mfa_code_invalid 를 실패 값으로 돌려준다). */
export const adminRequest = async (path: string, options: RequestInit = {}, extra: {credentialCheck?: boolean} = {}): Promise<any> => {
    const url = new URL(path, window.location.href);
    if(url.origin !== window.location.origin) return failure("Admin requests must use the same origin");
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
            if(!token) return failure("CSRF token cookie was not restored");
        }
        headers.set("X-CSRF-Token", token);
    }
    return requestJson(url, {...options, method, headers}, extra.credentialCheck === true);
};
