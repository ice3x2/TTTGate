import {adminRequest} from "./AdminRequest";
import type {ApiResult, MeResponse, SessionView} from "./Types";

// U3-01: 본인 정보·비밀번호 변경·마이그레이션 안내 확인. adminRequest 의 응답을 그대로 돌려준다(fetch 직접 사용 금지).
class MeCtrl {
    private static _instance: MeCtrl;

    private constructor() {
    }

    public static get instance(): MeCtrl {
        if(!MeCtrl._instance) {
            MeCtrl._instance = new MeCtrl();
        }
        return MeCtrl._instance;
    }

    public me(): Promise<ApiResult<MeResponse>> {
        return adminRequest("/api/me");
    }

    public changePassword(currentPassword: string, newPassword: string): Promise<ApiResult<{}>> {
        return adminRequest("/api/me/password", {
            method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify({currentPassword, newPassword})
        });
    }

    public acknowledgeMigration(): Promise<ApiResult<{}>> {
        return adminRequest("/api/me/acknowledge-migration", {method: "POST"});
    }

    /** U4-06: 본인 세션 목록. */
    public sessions(): Promise<ApiResult<{sessions: SessionView[]}>> {
        return adminRequest("/api/me/sessions");
    }

    /** U4-06: 현재 세션을 뺀 본인 세션을 모두 끊는다. */
    public logoutOthers(): Promise<ApiResult<{removed: number}>> {
        return adminRequest("/api/me/sessions/logout-others", {method: "POST"});
    }
}

export default MeCtrl;
