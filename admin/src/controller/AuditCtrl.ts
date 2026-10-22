import {adminRequest} from "./AdminRequest";
import type {ApiResult, AuditEventView, AuditQueryInput} from "./Types";

// U4-06: 감사 로그 조회. 빈 값은 쿼리에서 뺀다. 일반 유저는 서버가 본인 이벤트만 준다.
class AuditCtrl {
    private static _instance: AuditCtrl;

    private constructor() {
    }

    public static get instance(): AuditCtrl {
        if(!AuditCtrl._instance) {
            AuditCtrl._instance = new AuditCtrl();
        }
        return AuditCtrl._instance;
    }

    public list(input: AuditQueryInput): Promise<ApiResult<{events: AuditEventView[]; nextCursor?: string}>> {
        const params = new URLSearchParams();
        for(const [key, value] of Object.entries(input)) {
            if(value !== undefined && value !== '') params.set(key, String(value));
        }
        const query = params.toString();
        return adminRequest(query === '' ? "/api/audit" : `/api/audit?${query}`);
    }

    public types(): Promise<ApiResult<{types: string[]}>> {
        return adminRequest("/api/audit/types");
    }
}

export default AuditCtrl;
