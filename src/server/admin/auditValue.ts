/** 감사에 넣는 URL 유래 값(경로·경로 id)의 최대 길이. URL 은 헤더 상한(16KiB)까지 길어질 수 있다(#135·#173). */
export const MAX_AUDIT_VALUE_LENGTH = 256;

/** 상한을 넘는 값은 잘라 끝에 … 를 붙인다. 로그인한 사용자가 긴 URL 로 큰 감사 줄을 남기지 못하게 한다. */
export const truncateAuditValue = (value: string): string =>
    value.length > MAX_AUDIT_VALUE_LENGTH ? `${value.slice(0, MAX_AUDIT_VALUE_LENGTH)}…` : value;
