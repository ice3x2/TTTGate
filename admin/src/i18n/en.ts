// 이슈 349 — 관리 화면의 영어 문구. 키는 '화면이나 모듈.뜻' 꼴이다. ko.ts 는 이 파일의 키를 모두, 그리고 그것만 가져야 한다(FR-2).
// 값의 {name} 은 t(key, {name}) 가 채운다(FR-4). 개수에 따라 문구가 바뀌면 같은 이름에 _one·_other 를 붙인 두 키를 둔다.
// serverError.<code> 는 서버 실패 응답의 code 별 문구다(FR-7). 문구에 들어가는 값은 응답의 같은 이름 필드에서 온다.

export const en = {
    'common.unableToConnect': 'Unable to connect to the server.',

    'request.networkFailed': 'Admin network request failed: {reason}',
    'request.invalidJson': 'Invalid JSON response from admin server (HTTP {status})',
    'request.httpFailed': 'Admin request failed (HTTP {status})',
    'request.crossOrigin': 'Admin requests must use the same origin',
    'request.csrfNotRestored': 'CSRF token cookie was not restored',

    'time.justNow': 'just now',
    'time.minutesAgo': '{count} min ago',
    'time.hoursAgo': '{count} h ago',
    'time.daysAgo': '{count} d ago',
    'time.daysHoursMinutesSeconds': '{days}d {hours}h {minutes}m {seconds}s',
    'time.uptimeDays': '{days}d, {hours}h',
    'time.uptimeHours': '{hours}h, {minutes}m',
    'time.uptimeMinutes': '{minutes}m',
    'time.uptimeSeconds': '{seconds}s',

    'clock.leftMinutes': '{minutes}m {seconds}s left',
    'clock.leftHours': '{hours}h {minutes}m left',
    'clock.leftDays': '{days}d {hours}h left',
    'clock.endsToday': 'ends {time}',
    'clock.endsOtherDay': 'ends {month}/{day} {time}',
    'clock.noLimit': 'No time limit',
    'clock.label': '{left}, {ends}',
    'clock.labelEndingSoon': 'Ending soon, {left}, {ends}',

    'tunnel.connections_one': '{count} connection',
    'tunnel.connections_other': '{count} connections',
    'tunnel.applyFailed': 'Fail to apply tunneling option: {reason}',

    'login.tooManyAttempts': 'Too many login attempts. Please try again later.',
    'me.passkeyNotCreated': 'The passkey was not created.',

    'serverError.port_not_allowed': "This port is outside your group's allowed ranges.",
    'serverError.protocol_not_allowed': 'This protocol is not allowed for your group.',
    'serverError.rewrite_not_allowed': 'HTTP rewrite options are not allowed for your group.',
    'serverError.trusted_client_not_allowed': 'One of the selected trusted clients is not allowed for your group.',
    'serverError.tunnel_count_exceeded': 'You have reached your tunnel limit.',
    'serverError.buffer_limit_exceeded': "The server buffer is larger than the server's memory cache limit.",
    'serverError.password_incorrect': 'The password is incorrect.',
    'serverError.passkey_already_registered': 'This device already has a passkey for this account.',
    'serverError.passkey_limit': 'You can register up to {limit} passkeys.',
    'serverError.passkey_registration_expired': 'The setup expired. Try again.',
    'serverError.passkey_name_invalid': 'Enter a name of 1 to 64 characters.',
    'serverError.passkey_invalid': 'The passkey was not accepted.',
    'serverError.passkey_origin_unsupported': "Passkeys need a domain name with a trusted HTTPS certificate, or localhost. This address can't use them.",
    'serverError.passkey_unavailable': 'Sign in with your password first.',
    'serverError.passkey_busy': 'The server is busy. Try again in a minute.',
};

export type MessageKey = keyof typeof en;
/** 문구 리소스의 모양. 키가 빠지거나 남은 객체는 이 형이 아니다(AC-3). */
export type Messages = Record<MessageKey, string>;
