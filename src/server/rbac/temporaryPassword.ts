import crypto from "crypto";

/** 임시 비밀번호에 쓰는 문자 집합. 혼동하기 쉬운 문자를 빼지 않고 62자를 그대로 쓴다(설계 §5.2). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * 사용자 생성·비밀번호 초기화가 1회만 평문으로 내보내는 임시 비밀번호를 만든다.
 * 예측 가능한 Math.random 대신 crypto.randomInt 로 매 문자를 고른다.
 */
export function generateTemporaryPassword(length: number = 16): string {
    let password = '';
    for(let index = 0; index < length; index++) {
        password += ALPHABET[crypto.randomInt(ALPHABET.length)];
    }
    return password;
}
