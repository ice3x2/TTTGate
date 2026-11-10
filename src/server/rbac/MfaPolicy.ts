import type {GroupAttributes, User} from "./IdentityTypes";

// 이슈 346: 2단계 인증 강제 판정. 로그인, 요청마다의 주체 계산, 2단계 수단 삭제가 모두 이 모듈만 쓴다.
// 서버 옵션은 바깥(관리 서버)이 넘긴다. 이 모듈은 저장소와 시계를 읽지 않는 순수 함수다.

/** 슈퍼유저 강제(serverOption.mfaRequiredForSuperusers) 같은 서버 전체 설정. */
export type MfaPolicyOptions = {mfaRequiredForSuperusers: boolean};

type MfaSubject = Pick<User, 'id' | 'role' | 'mfa' | 'passkeys'>;

const LEGACY_ADMIN_USER_ID = 'legacy-admin';

/** TOTP 또는 패스키가 하나라도 있으면 2단계 수단을 갖춘 것이다. 패스키 로그인은 그 자체로 2단계를 거친 로그인이다. */
export function hasSecondFactor(user: Pick<User, 'mfa' | 'passkeys'>): boolean {
    return user.mfa?.enabled === true || (user.passkeys?.length ?? 0) > 0;
}

/**
 * 이 사용자가 2단계 인증 강제 대상인가. 슈퍼유저는 서버 옵션을, 일반 사용자는 그룹 속성 mfa_required 를 본다.
 * 레거시 관리자 계정은 대상이 아니다.
 */
export function isMfaRequired(user: MfaSubject, groupAttributes: Pick<GroupAttributes, 'mfa_required'> | undefined,
                              options: MfaPolicyOptions): boolean {
    if(user.id === LEGACY_ADMIN_USER_ID) return false;
    if(user.role === 'superuser') return options.mfaRequiredForSuperusers;
    return groupAttributes?.mfa_required === true;
}

/** 강제 대상인데 2단계 수단이 없으면 등록을 마칠 때까지 등록 전용 동작만 허용한다. */
export function mustEnrollMfa(user: MfaSubject, groupAttributes: Pick<GroupAttributes, 'mfa_required'> | undefined,
                              options: MfaPolicyOptions): boolean {
    return isMfaRequired(user, groupAttributes, options) && !hasSecondFactor(user);
}

/** 강제 대상이 TOTP 없이 패스키만 가졌으면 비밀번호 로그인으로 세션을 주지 않는다(passkey_required). */
export function requiresPasskeyLogin(user: MfaSubject, groupAttributes: Pick<GroupAttributes, 'mfa_required'> | undefined,
                                     options: MfaPolicyOptions): boolean {
    return isMfaRequired(user, groupAttributes, options) && user.mfa?.enabled !== true && (user.passkeys?.length ?? 0) > 0;
}

/** 본인이 이 2단계 수단을 지우면 강제 대상의 마지막 수단이 사라지는가. 관리자 초기화에는 쓰지 않는다. */
export function removesLastSecondFactor(user: MfaSubject, removing: 'totp' | 'passkey'): boolean {
    const totp = user.mfa?.enabled === true ? 1 : 0;
    const passkeys = user.passkeys?.length ?? 0;
    const remaining = removing === 'totp' ? passkeys : totp + Math.max(0, passkeys - 1);
    return remaining === 0;
}
