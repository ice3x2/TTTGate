import {adminRequest} from "./AdminRequest";
import type {ApiResult, IssuedEnrollmentCode, TrustedClientView} from "./Types";

// #213: 신뢰 클라이언트 관리. 만들기·지우기·비밀값 재생성은 서버 설정 revision 을 함께 보낸다.
class TrustedClientsCtrl {
    private static _instance: TrustedClientsCtrl;

    private constructor() {
    }

    public static get instance(): TrustedClientsCtrl {
        if(!TrustedClientsCtrl._instance) {
            TrustedClientsCtrl._instance = new TrustedClientsCtrl();
        }
        return TrustedClientsCtrl._instance;
    }

    public list(): Promise<ApiResult<{trustedClients: TrustedClientView[]}>> {
        return adminRequest("/api/trustedClients");
    }

    public create(clientId: string, displayName: string, expectedRevision: number): Promise<ApiResult<{trustedClient: TrustedClientView}>> {
        return adminRequest("/api/trustedClients", {method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({clientId, ...(displayName.trim() ? {displayName: displayName.trim()} : {}), expectedRevision})});
    }

    public remove(clientId: string, expectedRevision: number): Promise<ApiResult<object>> {
        return adminRequest(`/api/trustedClients/${encodeURIComponent(clientId)}`, {method: "DELETE", headers: {"Content-Type": "application/json"}, body: JSON.stringify({expectedRevision})});
    }

    public rotateSecret(clientId: string, expectedRevision: number): Promise<ApiResult<object>> {
        return adminRequest(`/api/trustedClients/${encodeURIComponent(clientId)}/secret`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({expectedRevision})});
    }

    /** ttlMinutes: 없으면 서버 기본(15분), null 이면 만료 없음(#313). */
    /**
     * 등록 코드를 임시로 받는다(#313). 기본(15분)보다 긴 기한은 confirmCode 로 확인할 때까지 기본 기한만 유효하다.
     * 코드를 보여 준 뒤에 확인하면, 아무도 보지 못한 긴 기한의 코드는 15분 뒤 사라진다.
     */
    public issueCode(clientId: string, ttlMinutes?: number | null): Promise<ApiResult<IssuedEnrollmentCode>> {
        return adminRequest(`/api/trustedClients/${encodeURIComponent(clientId)}/enrollmentCode`, {method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify(ttlMinutes === undefined ? {provisional: true} : {ttlMinutes, provisional: true})});
    }

    /** 보여 준 코드에 고른 기한을 적용한다(#313). */
    public confirmCode(clientId: string, issueId: number): Promise<ApiResult<{expiresAt: number | null}>> {
        return adminRequest(`/api/trustedClients/${encodeURIComponent(clientId)}/enrollmentCode/confirm`, {method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({issueId})});
    }
}

export default TrustedClientsCtrl;
