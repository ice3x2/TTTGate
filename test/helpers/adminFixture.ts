// 관리자 브라우저 테스트의 fixture 이름과 로그인 비밀번호. 드라이버(자식 프로세스)와
// startAdminApp(부모 프로세스)이 같은 값을 봐야 하므로 여기 한 곳에서만 정의한다.
// playwright 를 끌어오지 않도록 이 모듈은 아무것도 import 하지 않는다.

// 'rbac-no-audit' 은 rbac 에서 default 그룹의 admin_ui_section_access 에 my_audit 만 뺀 변형이다(U4-06, carol 용).
// 'rbac-mfa' 는 rbac 에서 alice 에게 MFA 를 켠 변형이다(U4-07).
export const ADMIN_FIXTURES = ['bootstrap', 'password', 'with-tunnels', 'regular-user', 'rbac', 'rbac-no-audit', 'rbac-mfa'] as const;

export type AdminFixture = typeof ADMIN_FIXTURES[number];

export const ADMIN_TEST_PASSWORD = 'test-password-1234';

// #102 (U2-10) 'regular-user' fixture 의 계정. alice 는 tunnels 섹션만 보는 일반 유저, temp 는 비밀번호 변경이 필요한 일반 유저다.
export const REGULAR_USER = {username: 'alice', password: 'alice-pass-1234'} as const;
export const TEMP_USER = {username: 'temp', password: 'temp-pass-1234'} as const;
