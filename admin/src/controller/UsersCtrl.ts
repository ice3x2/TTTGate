import {adminRequest} from "./AdminRequest";
import type {ApiResult, Role, UserStatus, UserView} from "./Types";

// U3-03: 사용자 관리 API. adminRequest 의 응답을 그대로 돌려준다(fetch 직접 사용 금지).
// 사용자 id 는 u_ + 16 hex 뿐이므로 경로에 그대로 붙인다.
class UsersCtrl {
    private static _instance: UsersCtrl;

    private constructor() {
    }

    public static get instance(): UsersCtrl {
        if(!UsersCtrl._instance) {
            UsersCtrl._instance = new UsersCtrl();
        }
        return UsersCtrl._instance;
    }

    public list(): Promise<ApiResult<{users: UserView[]}>> {
        return adminRequest("/api/users");
    }

    public get(id: string): Promise<ApiResult<{user: UserView}>> {
        return adminRequest(`/api/users/${id}`);
    }

    public create(input: {username: string; displayName?: string; role: Role; groupId?: string; temporaryPassword?: string})
        : Promise<ApiResult<{user: UserView; temporaryPassword: string}>> {
        return adminRequest("/api/users", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(input)});
    }

    public update(id: string, patch: {displayName?: string; role?: Role; status?: UserStatus; groupId?: string})
        : Promise<ApiResult<{user: UserView}>> {
        return adminRequest(`/api/users/${id}`, {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(patch)});
    }

    public remove(id: string): Promise<ApiResult<{}>> {
        return adminRequest(`/api/users/${id}`, {method: "DELETE"});
    }

    /** U4-09: 다른 사용자의 MFA 를 끈다. 서버가 그 사용자의 세션을 모두 끊는다. */
    public resetMfa(id: string): Promise<ApiResult<{user: UserView}>> {
        return adminRequest(`/api/users/${id}/mfa/reset`, {method: "POST"});
    }

    public resetPassword(id: string, temporaryPassword?: string): Promise<ApiResult<{temporaryPassword: string}>> {
        return adminRequest(`/api/users/${id}/password-reset`, {
            method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({temporaryPassword})
        });
    }
}

export default UsersCtrl;
