import {i18n, type Translator} from '../i18n';

// 이슈 336 — 패스키 화면이 함께 쓰는 판정. 서버의 판정(src/server/passkey/Passkey.ts passkeyRpIdOf)과 같은 규칙이다.
// 이슈 349: 패스키를 쓸 수 있는 조건의 문구는 리소스의 passkey.condition, 쓸 수 없다는 문구는 serverError.passkey_origin_unsupported 다.

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** 이 브라우저와 주소에서 패스키를 쓸 수 있는가. WebAuthn 지원, 보안 컨텍스트, IP 가 아닌 호스트 이름이어야 한다. */
export const passkeysAvailable = (): boolean => {
    if(typeof window.PublicKeyCredential !== 'function' || !window.isSecureContext) return false;
    const host = window.location.hostname;
    return host.length > 0 && !IPV4.test(host) && !host.includes(':') && !host.startsWith('[');
};

/**
 * 브라우저가 패스키 요청을 인증서 문제로 거절했는가. Firefox 는 SecurityError, Chromium 은 메시지에
 * certificate 가 들어간 NotAllowedError 를 낸다. 경고를 무시하고 들어온 자체 서명 인증서 페이지가 이 경우다.
 */
export const isCertificateError = (error: unknown): boolean => {
    if(!(error instanceof Error)) return false;
    return error.name === 'SecurityError' || (error.name === 'NotAllowedError' && /certificate/i.test(error.message));
};

const PREFERRED_KEY = 'tttgate.passkeyPreferred';

/**
 * 이슈 338: 이 브라우저에서 패스키 로그인이나 등록이 성공한 적이 있는가. 그렇다면 로그인 화면이 패스키를 먼저 보인다.
 * localStorage 는 브라우저 정책으로 막힐 수 있다. 이 접근만 예외로 감싸고, 읽지 못하면 없는 것으로 본다.
 */
export const passkeyPreferred = (): boolean => {
    try { return localStorage.getItem(PREFERRED_KEY) === '1'; } catch { return false; }
};

export const rememberPasskeyPreferred = (): void => {
    try { localStorage.setItem(PREFERRED_KEY, '1'); } catch { /* 저장하지 못하면 다음에도 비밀번호 칸을 먼저 보인다 */ }
};

/** 이슈 345: 서버가 이 기기의 패스키를 거부했다(예: 관리자가 초기화). 다음 방문부터 자동 요청을 보내지 않는다. */
export const forgetPasskeyPreferred = (): void => {
    try { localStorage.removeItem(PREFERRED_KEY); } catch { /* 지우지 못하면 다음에도 자동 요청이 한 번 실패한다 */ }
};

const SIGNED_OUT_KEY = 'tttgate.signedOut';

/** 이슈 345: 이 탭에서 방금 로그아웃했다. 바로 다음 로그인 화면은 패스키 창을 자동으로 띄우지 않는다. */
export const markSignedOut = (): void => {
    try { sessionStorage.setItem(SIGNED_OUT_KEY, '1'); } catch { /* 남기지 못하면 로그아웃 직후에도 자동 요청이 나간다 */ }
};

/** 로그아웃 표시를 한 번 읽고 지운다. 새로 고침하면 표시가 없으므로 다시 자동 요청을 보낸다. */
export const consumeSignedOut = (): boolean => {
    try {
        const marked = sessionStorage.getItem(SIGNED_OUT_KEY) === '1';
        sessionStorage.removeItem(SIGNED_OUT_KEY);
        return marked;
    } catch {
        return false;
    }
};

export const errorNameOf = (error: unknown): string => error instanceof Error ? error.name : '';

/** 등록 창의 이름 칸에 미리 넣을 기기 종류. 알 수 없으면 정한 언어의 '패스키' 다. */
export const defaultPasskeyName = (tr: Translator = i18n()): string => {
    const agent = navigator.userAgent;
    if(/iPhone/.test(agent)) return 'iPhone';
    if(/iPad/.test(agent)) return 'iPad';
    if(/Android/.test(agent)) return 'Android';
    if(/Windows/.test(agent)) return 'Windows';
    if(/Macintosh|Mac OS X/.test(agent)) return 'Mac';
    if(/Linux/.test(agent)) return 'Linux';
    return tr.t('passkey.defaultName');
};
