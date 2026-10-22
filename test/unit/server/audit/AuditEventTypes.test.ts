import {AUDIT_EVENT_TYPE_LIST, AUDIT_EVENT_TYPES, isAuditEventType} from "../../../../src/server/audit/AuditEventTypes";

// 설계 §2.2 가 확정한 이벤트 타입 표. 이 목록이 조회 API(#110)·단위 5 가 함께 쓰는 유일한 출처다.
const EXPECTED_TYPES = [
    "login_success", "login_failure",
    "mfa_success", "mfa_failure", "mfa_recovery_used",
    "mfa_enrolled", "mfa_disabled", "mfa_reset", "mfa_recovery_codes_regenerated",
    "logout", "session_killed", "sessions_killed_for_user", "sessions_killed_self_others",
    "user_created", "user_updated", "user_deleted", "user_status_changed", "role_changed",
    "temp_password_issued", "password_changed",
    "group_created", "group_updated", "group_attributes_changed", "group_deleted",
    "tunnel_created", "tunnel_updated", "tunnel_deleted",
    "tunnel_activated", "tunnel_deactivated", "tunnel_reassigned",
    "tunnel_cert_updated", "tunnel_cert_deleted",
    "server_option_updated", "admin_cert_updated",
    "security_geo_updated", "security_ban_removed",
    "access_denied", "last_superuser_guard_hit", "request_body_rejected",
    "conn_limit_hit", "tunnel_autoexpire",
    "audit_retention_pruned",
    // #212 신뢰 클라이언트·등록
    "trusted_client_created", "trusted_client_deleted", "trusted_client_secret_rotated",
    "enrollment_code_issued", "client_enrolled", "client_enroll_failed"
];

describe("AuditEventTypes", () => {
    it("표의 이름 48 개를 모두 담는다", () => {
        expect(AUDIT_EVENT_TYPE_LIST).toHaveLength(48);
        expect([...AUDIT_EVENT_TYPE_LIST].sort()).toEqual([...EXPECTED_TYPES].sort());
    });

    it("상수의 값은 키와 같은 문자열이다", () => {
        Object.entries(AUDIT_EVENT_TYPES).forEach(([key, value]) => {
            expect(value).toBe(key);
        });
    });

    it("isAuditEventType 이 표의 이름만 받는다", () => {
        expect(isAuditEventType("user_created")).toBe(true);
        expect(isAuditEventType("nope")).toBe(false);
    });

    it("isAuditEventType 이 프로토타입 키를 타입으로 받지 않는다", () => {
        expect(isAuditEventType("toString")).toBe(false);
        expect(isAuditEventType("constructor")).toBe(false);
    });
});
