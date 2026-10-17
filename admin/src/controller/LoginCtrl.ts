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

    /** 세션을 끝낸다. 실패해도 호출자는 로그인 화면으로 돌아간다(세션이 이미 없으면 401 이 InvalidSession 으로 온다). */
    public static async logout() : Promise<void> {
        await adminRequest("/api/logout", {method: "POST"});
    }

}
export default LoginCtrl;
