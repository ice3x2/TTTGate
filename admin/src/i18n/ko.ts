import type {Messages} from './en';

// 이슈 349 — 관리 화면의 한국어 문구. en.ts 와 키가 같아야 한다(형 검사가 확인한다, FR-2).
//
// 문체: 알림과 오류는 "~습니다", 사용자에게 시키는 말은 "~하세요" 로 쓴다. 단위 기호(KiB·Gb 등)와 코드 값은 옮기지 않는다.
//
// 용어 목록(FR-9). 같은 개념에는 아래 한국어만 쓴다.
//   tunnel                       터널
//   connection                   연결
//   port                         포트
//   group                        그룹
//   trusted client               신뢰 클라이언트
//   passkey                      패스키
//   password                     비밀번호
//   sign in / log in             로그인
//   two-factor authentication    2단계 인증
//   authenticator app            인증 앱
//   session                      세션
//   audit                        감사
//   server settings              서버 설정
//   admin server / request       관리 서버 / 관리 요청
//   HTTP rewrite                 HTTP 다시 쓰기
//   ends (시각)                   종료
//   left (남은 시간)               남음
//   apply                        적용
//   register                     등록

export const ko: Messages = {
    'common.unableToConnect': '서버에 연결하지 못했습니다.',

    'request.networkFailed': '관리 서버에 연결하지 못했습니다: {reason}',
    'request.invalidJson': '관리 서버의 응답이 올바른 JSON 이 아닙니다(HTTP {status}).',
    'request.httpFailed': '관리 요청이 실패했습니다(HTTP {status}).',
    'request.crossOrigin': '관리 요청은 같은 출처로만 보낼 수 있습니다.',
    'request.csrfNotRestored': 'CSRF 토큰 쿠키를 되살리지 못했습니다.',

    'time.justNow': '방금',
    'time.minutesAgo': '{count}분 전',
    'time.hoursAgo': '{count}시간 전',
    'time.daysAgo': '{count}일 전',
    'time.daysHoursMinutesSeconds': '{days}일 {hours}시간 {minutes}분 {seconds}초',
    'time.uptimeDays': '{days}일 {hours}시간',
    'time.uptimeHours': '{hours}시간 {minutes}분',
    'time.uptimeMinutes': '{minutes}분',
    'time.uptimeSeconds': '{seconds}초',

    'clock.leftMinutes': '{minutes}분 {seconds}초 남음',
    'clock.leftHours': '{hours}시간 {minutes}분 남음',
    'clock.leftDays': '{days}일 {hours}시간 남음',
    'clock.endsToday': '{time} 종료',
    'clock.endsOtherDay': '{month}월 {day}일 {time} 종료',
    'clock.noLimit': '시간 제한 없음',
    'clock.label': '{left}, {ends}',
    'clock.labelEndingSoon': '곧 종료, {left}, {ends}',

    'tunnel.connections_one': '연결 {count}개',
    'tunnel.connections_other': '연결 {count}개',
    'tunnel.applyFailed': '터널 설정을 적용하지 못했습니다: {reason}',

    'login.tooManyAttempts': '로그인 시도가 너무 많습니다. 잠시 뒤에 다시 시도하세요.',
    'me.passkeyNotCreated': '패스키를 만들지 못했습니다.',

    'serverError.port_not_allowed': '이 포트는 그룹에 허용된 범위 밖에 있습니다.',
    'serverError.protocol_not_allowed': '이 프로토콜은 그룹에 허용되지 않습니다.',
    'serverError.rewrite_not_allowed': 'HTTP 다시 쓰기 옵션은 그룹에 허용되지 않습니다.',
    'serverError.trusted_client_not_allowed': '고른 신뢰 클라이언트 가운데 그룹에 허용되지 않은 것이 있습니다.',
    'serverError.tunnel_count_exceeded': '만들 수 있는 터널 수를 모두 썼습니다.',
    'serverError.buffer_limit_exceeded': '서버 버퍼가 서버의 메모리 캐시 한도보다 큽니다.',
    'serverError.password_incorrect': '비밀번호가 틀렸습니다.',
    'serverError.passkey_already_registered': '이 기기에는 이 계정의 패스키가 이미 있습니다.',
    'serverError.passkey_limit': '패스키는 {limit}개까지 등록할 수 있습니다.',
    'serverError.passkey_registration_expired': '등록 시간이 지났습니다. 다시 시도하세요.',
    'serverError.passkey_name_invalid': '이름은 1~64자로 입력하세요.',
    'serverError.passkey_invalid': '패스키를 확인하지 못했습니다.',
    'serverError.passkey_origin_unsupported': '패스키는 신뢰할 수 있는 HTTPS 인증서가 있는 도메인 이름이나 localhost 에서만 쓸 수 있습니다. 이 주소에서는 쓸 수 없습니다.',
    'serverError.passkey_unavailable': '먼저 비밀번호로 로그인하세요.',
    'serverError.passkey_busy': '서버가 바쁩니다. 1분 뒤에 다시 시도하세요.',
};
