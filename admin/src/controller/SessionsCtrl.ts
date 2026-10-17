import {adminRequest} from "./AdminRequest";
import type {ApiResult, SessionView} from "./Types";

// U4-06: 슈퍼유저의 세션 관리. 본인 세션 목록·다른 기기 로그아웃은 MeCtrl 이 맡는다.
class SessionsCtrl {
    private static _instance: SessionsCtrl;

    private constructor() {
    }

    public static get instance(): SessionsCtrl {
        if(!SessionsCtrl._instance) {
            SessionsCtrl._instance = new SessionsCtrl();
        }
        return SessionsCtrl._instance;
    }

    public list(): Promise<ApiResult<{sessions: SessionView[]}>> {
        return adminRequest("/api/sessions");
    }

    public kill(id: string): Promise<ApiResult<{removed: boolean; self: boolean}>> {
        return adminRequest(`/api/sessions/${id}`, {method: "DELETE"});
    }

    public killAllForUser(userId: string): Promise<ApiResult<{removed: number; self: boolean}>> {
        return adminRequest(`/api/users/${userId}/sessions`, {method: "DELETE"});
    }
}

export default SessionsCtrl;
