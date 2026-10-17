import {adminRequest} from "./AdminRequest";

export type LoginUser = {id: string; username: string; displayName: string; role: 'superuser' | 'regular'};

export type LoginResult = {
    success: boolean;
    status: number;
    user?: LoginUser;
    mustChangePassword?: boolean;
    bootstrapRequired?: boolean;
    invalidBootstrapToken?: boolean;
    weakPassword?: boolean;
    invalidUsername?: boolean;
    message?: string;
    /** U4-07: MFA 가 켜진 계정의 1단계 응답. 쿠키 없이 티켓만 온다. */
    mfaRequired?: boolean;
    mfaTicket?: string;
    /** 실패 응답의 오류 코드(mfa_code_invalid 등). 화면이 분기에 쓴다. */
    code?: string;
};

class LoginCtrl {

    private constructor() {

    }

    public static async validateSession() : Promise<boolean> {

        let result = await fetch("/api/validateSession", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await result.json();
        return json['valid'];
    }

    // #102 (U2-10): 진입점 하나. 서버의 {key} 별칭은 지워졌다.
    public static async login(username: string, password: string, bootstrapToken?: string) : Promise<LoginResult> {
        let result = await fetch("/api/login", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                'Content-Type': 'application/json'
            }
            ,body: JSON.stringify({username, password, bootstrapToken})
        })
        let json = await result.json();
        return {...json, status: result.status, success: result.ok && json.success === true};
    }

    /**
     * U4-07: 2단계 로그인. login() 과 같이 응답을 그대로 돌려준다. adminRequest 는 401 을 InvalidSession 으로 던지므로 쓰지 않는다
     * (이 경로의 401 은 세션 만료가 아니라 mfa_code_invalid·mfa_ticket_invalid 이고 화면이 코드로 분기한다).
     */
    public static async loginMfa(mfaTicket: string, input: {code: string} | {recoveryCode: string}) : Promise<LoginResult> {
        const result = await fetch("/api/login/mfa", {
            method: "POST",
            credentials: "same-origin",
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({mfaTicket, ...input})
        });
        const json = await result.json();
        return {...json, status: result.status, success: result.ok && json.success === true};
    }

    /** 세션을 끝낸다. 실패해도 호출자는 로그인 화면으로 돌아간다(세션이 이미 없으면 401 이 InvalidSession 으로 온다). */
    public static async logout() : Promise<void> {
        await adminRequest("/api/logout", {method: "POST"});
    }

}
export default LoginCtrl;
