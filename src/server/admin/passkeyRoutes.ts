import {IncomingMessage} from "http";
import {mfaPolicyOptions} from "./mfaPolicyOptions";
import {isMfaRequired, removesLastSecondFactor} from "../rbac/MfaPolicy";
import type * as WebAuthnServer from "@simplewebauthn/server";
import {RouteContext, RouteHandlers, decodedPathSegment} from "./routes";
import {LoginGuard} from "./mfaLoginRoutes";
import {passwordConfirmed, selfUserOf} from "./rbacRoutes";
import {IdentityStore} from "../rbac/IdentityStore";
import {IdentityMigration} from "../rbac/IdentityMigration";
import {User} from "../rbac/IdentityTypes";
import {toUserView} from "../rbac/UserView";
import SessionStore from "./SessionStore";
import {AUDIT_EVENT_TYPES} from "../audit/AuditEventTypes";
import {ClockRngProvider} from "../../util/ClockRng";
import LoggerFactory from "../../util/logger/LoggerFactory";
import {
    Passkey, PASSKEY_LIMIT, passkeyNameOf, passkeyRpIdOf, sanitizeTransports, toPasskeyView
} from "../passkey/Passkey";
import {PendingPasskeyRegistrations} from "../passkey/PendingPasskeyRegistrations";
import {ChallengeScope, PasskeyLoginChallenges} from "../passkey/PasskeyLoginChallenges";

// #336 — 관리 화면 패스키. 등록·목록·삭제(REQ-4~7), 패스키 로그인(REQ-8~10), 관리자 초기화(REQ-11).
// 서명·형식 검증은 @simplewebauthn/server 만 한다. 이 파일은 범위(Origin·RP ID·사용자)와 저장·감사를 맡는다.

export type PasskeyState = {registrations: PendingPasskeyRegistrations; challenges: PasskeyLoginChallenges};

const logger = LoggerFactory.getLogger('server', 'Passkey');

let webAuthnModule: Promise<typeof WebAuthnServer> | undefined;
/**
 * 라이브러리는 패스키 경로를 처음 부를 때만 읽는다. x509·ASN.1 모듈을 많이 읽어 느린 디스크에서는 수십 초가 걸리므로,
 * 모든 CLI 명령과 클라이언트 모드가 그 비용을 내지 않게 한다. 문자열 상수로 부르므로 pkg 도 이 모듈을 묶는다.
 */
const webAuthn = (): Promise<typeof WebAuthnServer> => webAuthnModule ??= import("@simplewebauthn/server");

const RP_NAME = 'TTTGate';
/** EdDSA, ES256, RS256. 라이브러리 기본값과 같지만 스펙(REQ-4)에 적은 값이므로 명시한다. */
const SUPPORTED_ALGORITHMS = [-8, -7, -257];
const LOGIN_TIMEOUT_MS = 120_000;
const ORIGIN_UNSUPPORTED = {code: 'passkey_origin_unsupported', message: 'Passkeys need a domain name with a trusted HTTPS certificate, or localhost.'};
const PASSKEY_REJECTED = {code: 'passkey_invalid', message: 'The passkey was not accepted.'};

type LoginFailureReason = 'challenge' | 'credential' | 'user' | 'verification' | 'store';

const now = (): number => ClockRngProvider.current().now();

const originOf = (req: IncomingMessage): string | undefined => {
    const raw = req.headers['origin'];
    return Array.isArray(raw) ? raw[0] : raw;
};

/** 요청 Origin 과 그 RP ID. 패스키를 쓸 수 없는 Origin 이면 422 를 보내고 undefined 다. */
const passkeyScopeOf = (ctx: RouteContext): {origin: string; rpId: string} | undefined => {
    const origin = originOf(ctx.req);
    const rpId = passkeyRpIdOf(origin);
    if(origin === undefined || rpId === undefined) {
        ctx.fail(422, ORIGIN_UNSUPPORTED.code, ORIGIN_UNSUPPORTED.message);
        return undefined;
    }
    return {origin, rpId};
};

const userHandleOf = (user: User): string => Buffer.from(user.id, 'utf8').toString('base64url');

/** 클라이언트 응답의 clientDataJSON 에서 challenge 를 읽는다. 형식이 틀리면 undefined 다. */
const challengeOf = (response: any): string | undefined => {
    const encoded = response?.response?.clientDataJSON;
    if(typeof encoded !== 'string') return undefined;
    // JSON.parse 에는 던지지 않는 변형이 없다. 인증 없는 입력이므로 형식 오류는 실패로 바꾼다.
    try {
        const challenge = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))?.challenge;
        return typeof challenge === 'string' ? challenge : undefined;
    } catch {
        return undefined;
    }
};

const ERROR_TEXT_MAX = 200;

/**
 * 검증 실패 진단 로그의 본문. 라이브러리 메시지에는 인증 없는 요청의 값(origin·challenge)이 들어갈 수 있으므로
 * 제어 문자를 ? 로 바꿔 가짜 로그 줄을 만들지 못하게 하고 200자로 자른다. 공개키는 메시지에 들어가지 않는다.
 */
export const verificationErrorText = (error: unknown): string => {
    const raw = error instanceof Error ? error.message : String(error);
    const text = raw.replace(/[\x00-\x1f\x7f]/g, '?').slice(0, ERROR_TEXT_MAX);
    return error instanceof Error ? `${error.name}: ${text}` : text;
};

/**
 * 라이브러리 검증. 라이브러리는 형식·서명 오류를 예외로 알리므로(우리가 고를 수 없는 계약이다) 여기서만 받아
 * 검증 실패로 바꾼다. 다른 곳에서는 예외로 흐름을 나누지 않는다.
 */
const settle = async <T>(task: () => Promise<T>): Promise<T | undefined> => {
    try {
        return await task();
    } catch(error) {
        logger.debug(`passkey verification failed: ${verificationErrorText(error)}`);
        return undefined;
    }
};

export function passkeyRouteHandlers(state: PasskeyState, guard: LoginGuard): RouteHandlers {

    const onPasskeyRegistrationOptions = async (ctx: RouteContext): Promise<void> => {
        const user = selfUserOf(ctx);
        if(!user) return;
        const scope = passkeyScopeOf(ctx);
        if(!scope || !await passwordConfirmed(ctx, user)) return;
        const owned = user.passkeys ?? [];
        if(owned.length >= PASSKEY_LIMIT) {
            ctx.fail(409, 'passkey_limit', `You can register up to ${PASSKEY_LIMIT} passkeys.`);
            return;
        }
        const options = await (await webAuthn()).generateRegistrationOptions({
            rpName: RP_NAME, rpID: scope.rpId,
            userID: new Uint8Array(Buffer.from(user.id, 'utf8')), userName: user.username, userDisplayName: user.displayName,
            attestationType: 'none', supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
            authenticatorSelection: {residentKey: 'required', userVerification: 'required'},
            excludeCredentials: owned.filter((passkey) => passkey.rpId === scope.rpId)
                .map((passkey) => ({id: passkey.id, transports: passkey.transports}))
        });
        state.registrations.set(user.id, {challenge: options.challenge, origin: scope.origin, rpId: scope.rpId});
        ctx.ok({options});
    };

    const onRegisterPasskey = async (ctx: RouteContext): Promise<void> => {
        const user = selfUserOf(ctx);
        if(!user) return;
        const name = passkeyNameOf(ctx.body?.name);
        if(name === undefined) {
            ctx.fail(422, 'passkey_name_invalid', 'Enter a name of 1 to 64 characters.');
            return;
        }
        const pending = state.registrations.peek(user.id);
        if(!pending) {
            ctx.fail(409, 'passkey_registration_expired', 'The setup expired. Try again.');
            return;
        }
        // 대기 값은 결과와 관계없이 한 번만 쓴다.
        state.registrations.consume(user.id);
        const response = ctx.body?.response;
        const {verifyRegistrationResponse} = await webAuthn();
        const verification = originOf(ctx.req) !== pending.origin ? undefined : await settle(() => verifyRegistrationResponse({
            response, expectedChallenge: pending.challenge, expectedOrigin: pending.origin, expectedRPID: pending.rpId,
            requireUserVerification: true, supportedAlgorithmIDs: SUPPORTED_ALGORITHMS
        }));
        if(!verification?.verified) {
            ctx.fail(400, 'passkey_invalid', 'The passkey could not be verified. Try again.');
            return;
        }
        const {credential, credentialBackedUp} = verification.registrationInfo;
        const passkey: Passkey = {
            id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter,
            transports: sanitizeTransports(response?.response?.transports), rpId: pending.rpId, name,
            createdAt: now(), backedUp: credentialBackedUp
        };
        const saved = IdentityStore.instance.addPasskey(user.id, passkey);
        if(!saved.success) {
            ctx.fail(saved.status, saved.code, saved.message);
            return;
        }
        ctx.auditDetail({passkeyId: passkey.id, name});
        ctx.ok({passkey: toPasskeyView(passkey)});
    };

    const onListPasskeys = async (ctx: RouteContext): Promise<void> => {
        const user = selfUserOf(ctx);
        if(!user) return;
        const passkeys = [...(user.passkeys ?? [])].sort((a, b) => b.createdAt - a.createdAt).map(toPasskeyView);
        ctx.ok({passkeys});
    };

    const onRemovePasskey = async (ctx: RouteContext): Promise<void> => {
        const user = selfUserOf(ctx);
        if(!user) return;
        const id = decodedPathSegment(ctx.params.id) ?? '';
        // 이슈 346: 강제 대상은 마지막 2단계 수단(TOTP 가 없을 때의 마지막 패스키)을 지울 수 없다.
        const owned = (user.passkeys ?? []).some((passkey) => passkey.id === id);
        if(owned && isMfaRequired(user, IdentityStore.instance.group(user.groupId)?.attributes, mfaPolicyOptions())
            && removesLastSecondFactor(user, 'passkey')) {
            ctx.fail(409, 'mfa_required', 'Two-factor authentication is required for your account. Set up an authenticator app before removing your last passkey.');
            return;
        }
        const removed = IdentityStore.instance.removePasskey(user.id, id);
        if(!removed.success) {
            ctx.fail(removed.status, removed.code, removed.message);
            return;
        }
        ctx.auditDetail({passkeyId: removed.value.id, name: removed.value.name});
        ctx.ok({});
    };

    /** 슈퍼유저가 남의 패스키를 모두 지운다. 없어도 200(멱등)이고 대상의 세션을 모두 끊는다(MFA 초기화와 같다). */
    const onResetUserPasskeys = async (ctx: RouteContext): Promise<void> => {
        const store = IdentityStore.instance;
        const cleared = store.clearPasskeys(ctx.params.id);
        if(!cleared.success) {
            ctx.fail(cleared.status, cleared.code, cleared.message);
            return;
        }
        SessionStore.instance.removeSessionsOfUser(ctx.params.id);
        ctx.auditDetail({removed: cleared.value.removed});
        ctx.ok({user: toUserView(store.user(ctx.params.id)!, store.groups(), mfaPolicyOptions())});
    };

    /** 계정 저장소가 없거나 첫 관리자 설정 전이면 503 을 보내고 false 다. */
    const loginAvailable = (ctx: RouteContext): boolean => {
        if(IdentityStore.instance.mode === 'legacy-fallback' || IdentityMigration.bootstrapRequired()) {
            ctx.fail(503, 'passkey_unavailable', 'Sign in with your password first.');
            return false;
        }
        return true;
    };

    const onPasskeyLoginOptions = async (ctx: RouteContext): Promise<void> => {
        const scope = passkeyScopeOf(ctx);
        if(!scope || !loginAvailable(ctx)) return;
        const options = await (await webAuthn()).generateAuthenticationOptions({
            rpID: scope.rpId, userVerification: 'required', allowCredentials: [], timeout: LOGIN_TIMEOUT_MS,
            challenge: state.challenges.issue({...scope, ip: ctx.ip})
        });
        ctx.ok({options});
    };

    const onLoginPasskey = async (ctx: RouteContext): Promise<void> => {
        const {req, res} = ctx;
        const scope = passkeyScopeOf(ctx);
        if(!scope || !loginAvailable(ctx)) return;
        // admitLogin 은 본문을 읽기 전에 차단을 봤다. 본문을 받는 사이 차단되었을 수 있으므로 다시 본다(#265).
        if(guard.isBlocked(req)) {
            guard.sendFailure(res, 429, {message: 'Too many login attempts'});
            return;
        }
        const challengeScope: ChallengeScope = {...scope, ip: ctx.ip};
        const auditFailure = (reason: LoginFailureReason) => guard.emitAudit({
            at: now(), actor: {userId: 'system'}, ip: ctx.ip, type: AUDIT_EVENT_TYPES.login_failure, outcome: 'failure',
            summary: `${AUDIT_EVENT_TYPES.login_failure} passkey`, detail: {method: 'passkey', reason}
        });
        const reject = async (reason: Exclude<LoginFailureReason, 'store'>): Promise<void> => {
            auditFailure(reason);
            await guard.fail(req);
            guard.sendFailure(res, 401, {status: 401, ...PASSKEY_REJECTED});
        };

        const response = ctx.body?.response;
        const challenge = challengeOf(response);
        const use = challenge === undefined ? 'invalid' : state.challenges.consume(challenge, challengeScope);
        if(use === 'busy') {
            // 사용자의 잘못이 아니므로 실패 횟수에 넣지 않는다.
            ctx.fail(503, 'passkey_busy', 'The server is busy. Try again in a minute.');
            return;
        }
        if(use === 'invalid') return reject('challenge');

        const store = IdentityStore.instance;
        const found = typeof response?.id === 'string' ? store.findPasskey(response.id) : undefined;
        if(!found || found.passkey.rpId !== scope.rpId) return reject('credential');
        const {user, passkey} = found;
        const userHandle = response.response?.userHandle;
        if(user.status === 'disabled' || (userHandle !== undefined && userHandle !== userHandleOf(user))) return reject('user');

        const {verifyAuthenticationResponse} = await webAuthn();
        const verification = await settle(() => verifyAuthenticationResponse({
            response, expectedOrigin: scope.origin, expectedRPID: scope.rpId, requireUserVerification: true,
            expectedChallenge: (value: string) => state.challenges.matches(value, challengeScope),
            credential: {
                id: passkey.id, publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
                counter: passkey.counter, transports: passkey.transports
            }
        }));
        if(!verification?.verified) return reject('verification');

        const {newCounter, credentialBackedUp} = verification.authenticationInfo;
        const used = store.markPasskeyUsed(user.id, passkey.id, {counter: newCounter, backedUp: credentialBackedUp, at: now()});
        // 검증하는 사이 패스키가 지워졌거나, 다른 로그인이 더 큰 카운터를 먼저 저장했다.
        if(!used.success && used.code === 'passkey_not_found') return reject('credential');
        if(!used.success && used.code === 'passkey_counter_stale') return reject('verification');
        if(!used.success) {
            // 카운터를 저장하지 못하면 복제 탐지를 보장할 수 없으므로 세션을 주지 않는다. 사용자의 잘못이 아니므로 세지 않는다.
            auditFailure('store');
            guard.sendFailure(res, 503, {status: 503, message: 'Unable to complete sign-in. Try again.'});
            return;
        }
        await guard.issueSession(req, res, store.user(user.id)!, {method: 'passkey', passkeyId: passkey.id});
    };

    return {
        onPasskeyRegistrationOptions, onRegisterPasskey, onListPasskeys, onRemovePasskey, onResetUserPasskeys,
        onPasskeyLoginOptions, onLoginPasskey
    };
}
