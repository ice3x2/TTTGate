/**
 * 감사 이벤트 타입 표(단위 4 설계 §2.2). 기록부·조회 API·단위 5 런타임이 함께 쓰는 유일한 출처다.
 * 문자열 리터럴로 적으면 기록과 조회가 조용히 갈리므로 호출부는 반드시 이 상수를 쓴다.
 */
export const AUDIT_EVENT_TYPES = {
    // 로그인·MFA (/api/login, /api/login/mfa)
    login_success: 'login_success', login_failure: 'login_failure',
    mfa_success: 'mfa_success', mfa_failure: 'mfa_failure', mfa_recovery_used: 'mfa_recovery_used',
    mfa_enrolled: 'mfa_enrolled', mfa_disabled: 'mfa_disabled', mfa_reset: 'mfa_reset',
    mfa_recovery_codes_regenerated: 'mfa_recovery_codes_regenerated',
    // 세션
    logout: 'logout', session_killed: 'session_killed',
    sessions_killed_for_user: 'sessions_killed_for_user', sessions_killed_self_others: 'sessions_killed_self_others',
    // 사용자
    user_created: 'user_created', user_updated: 'user_updated', user_deleted: 'user_deleted',
    user_status_changed: 'user_status_changed', role_changed: 'role_changed',
    temp_password_issued: 'temp_password_issued', password_changed: 'password_changed',
    // 그룹
    group_created: 'group_created', group_updated: 'group_updated',
    group_attributes_changed: 'group_attributes_changed', group_deleted: 'group_deleted',
    // 터널
    tunnel_created: 'tunnel_created', tunnel_updated: 'tunnel_updated', tunnel_deleted: 'tunnel_deleted',
    tunnel_activated: 'tunnel_activated', tunnel_deactivated: 'tunnel_deactivated', tunnel_reassigned: 'tunnel_reassigned',
    tunnel_cert_updated: 'tunnel_cert_updated', tunnel_cert_deleted: 'tunnel_cert_deleted',
    // 서버
    server_option_updated: 'server_option_updated', admin_cert_updated: 'admin_cert_updated',
    // 신뢰 클라이언트·등록(#212). 코드·비밀값은 감사에 남기지 않는다.
    trusted_client_created: 'trusted_client_created', trusted_client_deleted: 'trusted_client_deleted',
    trusted_client_secret_rotated: 'trusted_client_secret_rotated', enrollment_code_issued: 'enrollment_code_issued',
    client_enrolled: 'client_enrolled', client_enroll_failed: 'client_enroll_failed',
    // 연결 보안 (단위 5 가 기록)
    security_geo_updated: 'security_geo_updated', security_ban_removed: 'security_ban_removed',
    security_block_added: 'security_block_added', security_block_removed: 'security_block_removed',
    // 가드·런타임
    access_denied: 'access_denied', last_superuser_guard_hit: 'last_superuser_guard_hit',
    conn_limit_hit: 'conn_limit_hit', tunnel_autoexpire: 'tunnel_autoexpire',
    audit_retention_pruned: 'audit_retention_pruned',
    // #135: 본문을 읽다가 실패한 감사 대상 CUD 요청(대상 없음)
    request_body_rejected: 'request_body_rejected'
} as const;

export type AuditEventType = keyof typeof AUDIT_EVENT_TYPES;

export const AUDIT_EVENT_TYPE_LIST: readonly AuditEventType[] = Object.keys(AUDIT_EVENT_TYPES) as AuditEventType[];

/** `value in AUDIT_EVENT_TYPES` 는 'toString' 에도 true 를 내므로 자기 속성만 본다. */
export const isAuditEventType = (value: string): value is AuditEventType =>
    Object.prototype.hasOwnProperty.call(AUDIT_EVENT_TYPES, value);
