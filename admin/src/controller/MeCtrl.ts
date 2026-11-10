import {adminRequest} from "./AdminRequest";
import type {PublicKeyCredentialCreationOptionsJSON, RegistrationResponseJSON} from "@simplewebauthn/browser";
import type {ApiResult, MeResponse, PasskeyView, SessionView} from "./Types";

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

    /** U4-09: MFA 등록 시작. 평문 secret·복구 코드는 이 응답에만 온다. */
    /**
     * 인증 앱 등록을 시작한다. 이슈 346: 이미 켜져 있으면 replace 와 비밀번호로 새 인증 앱으로 바꾼다
     * (확인을 마칠 때까지 기존 인증 앱이 그대로다). 비밀번호가 틀리면 401 password_incorrect 를 실패 값으로 돌려준다.
     */
    public enrollMfa(replace?: {password: string}): Promise<ApiResult<{secret: string; otpauthUri: string; recoveryCodes: string[]}>> {
        if(!replace) return adminRequest("/api/me/mfa/enroll", {method: "POST"});
        return adminRequest("/api/me/mfa/enroll", {method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({replace: true, password: replace.password})}, {credentialCheck: true});
    }

    public confirmMfa(code: string): Promise<ApiResult<{mfa: {enabled: boolean; recoveryCodesRemaining: number}}>> {
        return adminRequest("/api/me/mfa/confirm", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({code})},
            {credentialCheck: true});
    }

    public disableMfa(password: string): Promise<ApiResult<{}>> {
        return adminRequest("/api/me/mfa", {method: "DELETE", headers: {"Content-Type": "application/json"}, body: JSON.stringify({password})},
            {credentialCheck: true});
    }

    public regenerateRecoveryCodes(password: string): Promise<ApiResult<{recoveryCodes: string[]}>> {
        return adminRequest("/api/me/mfa/recovery-codes", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({password})},
            {credentialCheck: true});
    }

    /** #336: 본인 패스키 목록(최신 순). */
    public passkeys(): Promise<ApiResult<{passkeys: PasskeyView[]}>> {
        return adminRequest("/api/me/passkeys");
    }

    /** #336: 비밀번호를 다시 확인하고 등록 옵션을 받는다. */
    public passkeyOptions(password: string): Promise<ApiResult<{options: PublicKeyCredentialCreationOptionsJSON}>> {
        return adminRequest("/api/me/passkeys/options", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({password})},
            {credentialCheck: true});
    }

    public registerPasskey(name: string, response: RegistrationResponseJSON): Promise<ApiResult<{passkey: PasskeyView}>> {
        return adminRequest("/api/me/passkeys", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name, response})});
    }

    public removePasskey(id: string): Promise<ApiResult<{}>> {
        return adminRequest(`/api/me/passkeys/${encodeURIComponent(id)}`, {method: "DELETE"});
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
