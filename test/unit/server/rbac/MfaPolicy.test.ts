import {hasSecondFactor, isMfaRequired, mustEnrollMfa, removesLastSecondFactor, requiresPasskeyLogin} from "../../../../src/server/rbac/MfaPolicy";
import type {Passkey} from "../../../../src/server/passkey/Passkey";
import type {UserMfa} from "../../../../src/server/rbac/IdentityTypes";

// #346 FR-2 — 2단계 인증 강제 판정 함수.

const TOTP: UserMfa = {enabled: true, secret: "AAAA", enrolledAt: 1, lastUsedStep: 0, recoveryCodeHashes: []};
const KEY = {id: "k1"} as Passkey;
const user = (overrides: {id?: string; role?: "superuser" | "regular"; mfa?: UserMfa; passkeys?: Passkey[]} = {}) =>
    ({id: "u1", role: "regular" as const, ...overrides});
const OFF = {mfaRequiredForSuperusers: false};
const ON = {mfaRequiredForSuperusers: true};

describe("MfaPolicy", () => {
    test("TOTP 나 패스키가 하나라도 있으면 2단계 수단을 갖췄다", () => {
        expect(hasSecondFactor(user())).toBe(false);
        expect(hasSecondFactor(user({mfa: TOTP}))).toBe(true);
        expect(hasSecondFactor(user({mfa: {...TOTP, enabled: false}}))).toBe(false);
        expect(hasSecondFactor(user({passkeys: [KEY]}))).toBe(true);
    });

    test("일반 사용자는 그룹 속성을, 슈퍼유저는 서버 옵션을 보고, 레거시 관리자는 대상이 아니다", () => {
        expect(isMfaRequired(user(), {mfa_required: true}, OFF)).toBe(true);
        expect(isMfaRequired(user(), {mfa_required: false}, ON)).toBe(false);
        expect(isMfaRequired(user(), undefined, ON)).toBe(false);
        expect(isMfaRequired(user({role: "superuser"}), {mfa_required: false}, ON)).toBe(true);
        expect(isMfaRequired(user({role: "superuser"}), {mfa_required: true}, OFF)).toBe(false);
        expect(isMfaRequired(user({id: "legacy-admin", role: "superuser"}), undefined, ON)).toBe(false);
    });

    test("강제 대상이고 수단이 없을 때만 등록을 강제한다", () => {
        expect(mustEnrollMfa(user(), {mfa_required: true}, OFF)).toBe(true);
        expect(mustEnrollMfa(user({passkeys: [KEY]}), {mfa_required: true}, OFF)).toBe(false);
        expect(mustEnrollMfa(user({mfa: TOTP}), {mfa_required: true}, OFF)).toBe(false);
        expect(mustEnrollMfa(user(), {mfa_required: false}, OFF)).toBe(false);
    });

    test("강제 대상이 TOTP 없이 패스키만 가졌을 때만 패스키 로그인을 요구한다", () => {
        expect(requiresPasskeyLogin(user({passkeys: [KEY]}), {mfa_required: true}, OFF)).toBe(true);
        expect(requiresPasskeyLogin(user({passkeys: [KEY], mfa: TOTP}), {mfa_required: true}, OFF)).toBe(false);
        expect(requiresPasskeyLogin(user({passkeys: [KEY]}), {mfa_required: false}, OFF)).toBe(false);
        expect(requiresPasskeyLogin(user(), {mfa_required: true}, OFF)).toBe(false);
    });

    test("지운 뒤 남는 수단이 없으면 마지막 수단이다", () => {
        expect(removesLastSecondFactor(user({mfa: TOTP}), "totp")).toBe(true);
        expect(removesLastSecondFactor(user({mfa: TOTP, passkeys: [KEY]}), "totp")).toBe(false);
        expect(removesLastSecondFactor(user({passkeys: [KEY]}), "passkey")).toBe(true);
        expect(removesLastSecondFactor(user({passkeys: [KEY, {id: "k2"} as Passkey]}), "passkey")).toBe(false);
        expect(removesLastSecondFactor(user({mfa: TOTP, passkeys: [KEY]}), "passkey")).toBe(false);
    });
});
