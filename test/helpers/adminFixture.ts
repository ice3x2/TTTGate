// 관리자 브라우저 테스트의 fixture 이름과 로그인 비밀번호. 드라이버(자식 프로세스)와
// startAdminApp(부모 프로세스)이 같은 값을 봐야 하므로 여기 한 곳에서만 정의한다.
// playwright 를 끌어오지 않도록 이 모듈은 아무것도 import 하지 않는다.

export const ADMIN_FIXTURES = ['bootstrap', 'password', 'with-tunnels'] as const;

export type AdminFixture = typeof ADMIN_FIXTURES[number];

export const ADMIN_TEST_PASSWORD = 'test-password-1234';
