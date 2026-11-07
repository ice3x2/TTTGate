// 이슈 336 — 패스키 화면이 함께 쓰는 판정과 문구. 서버의 판정(src/server/passkey/Passkey.ts passkeyRpIdOf)과 같은 규칙이다.

export const PASSKEY_CONDITION = 'Passkeys need a domain name with a trusted HTTPS certificate, or localhost.';
export const PASSKEY_UNSUPPORTED = `${PASSKEY_CONDITION} This address can't use them.`;

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

export const errorNameOf = (error: unknown): string => error instanceof Error ? error.name : '';

/** 등록 창의 이름 칸에 미리 넣을 기기 종류. */
export const defaultPasskeyName = (): string => {
    const agent = navigator.userAgent;
    if(/iPhone/.test(agent)) return 'iPhone';
    if(/iPad/.test(agent)) return 'iPad';
    if(/Android/.test(agent)) return 'Android';
    if(/Windows/.test(agent)) return 'Windows';
    if(/Macintosh|Mac OS X/.test(agent)) return 'Mac';
    if(/Linux/.test(agent)) return 'Linux';
    return 'Passkey';
};
