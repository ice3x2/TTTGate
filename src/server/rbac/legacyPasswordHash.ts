import {createHash} from "crypto";

/**
 * 레거시 관리자 비밀번호 해시(SessionStore.ts의 hashPassword)를 바이트 단위로 그대로 옮긴 것.
 * IdentityStore 와 IdentityMigration 이 둘 다 이 함수를 쓰므로, 두 모듈의 순환 import를
 * 피하기 위해 별도 파일에 둔다.
 */
export function hashLegacyPassword(password: string): string {
    const normalizedPassword = password.trim() + '@';
    let salt = '';
    for(let i = 0; i < normalizedPassword.length; i++) {
        salt += Math.round(normalizedPassword.charCodeAt(i) / 2).toString(16);
    }
    return createHash('sha512').update(normalizedPassword + salt).digest('hex');
}
