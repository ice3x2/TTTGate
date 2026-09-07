import InvalidSession from "./InvalidSession";

const failure = (message: string, status = 0) => ({success: false, status, message});
const csrfCookie = (): string => {
    const entry = document.cookie.split(";").map((part) => part.trim())
        .find((part) => part.startsWith("csrfToken="));
    return entry ? entry.slice("csrfToken=".length) : "";
};

const requestJson = async (url: URL, options: RequestInit): Promise<any> => {
    let response: Response;
    try {
        response = await fetch(url.href, {...options, credentials: "same-origin", redirect: "error"});
    } catch(error) {
        return failure(`Admin network request failed: ${error instanceof Error ? error.message : String(error)}`);
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

export const adminRequest = async (path: string, options: RequestInit = {}): Promise<any> => {
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
    return requestJson(url, {...options, method, headers});
};
