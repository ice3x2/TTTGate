import * as crypto from "crypto";

/**
 * 타이밍 공격에 안전한 문자열/버퍼 비교 헬퍼 (REQ-04, REQ-21).
 *
 * 현실적 API 계약:
 *  - 본 헬퍼는 **동일 길이의 비밀 버퍼** 간 바이트 비교가 상수시간임을 보장한다
 *    (내부적으로 Node.js `crypto.timingSafeEqual`에 위임).
 *  - 입력 길이 자체는 **공격자 추정 가능한 정보**로 취급한다. 토큰/세션ID/
 *    키의 길이는 설계 상 고정값이므로 비밀이 아니다. 따라서 hex 디코딩·
 *    버퍼 할당·복사 등 preamble 비용이 입력 길이에 선형 종속하더라도,
 *    이는 비밀이 아닌 "입력 길이"에만 의존하므로 실질 보안 영향이 없다.
 *  - 길이 불일치 시에도 `timingSafeEqual` dummy 비교를 수행하여, 동일 길이
 *    컨텍스트 내에서의 내용-기반 분기가 발생하지 않도록 한다.
 *  - 최종 결과는 `(길이 일치) AND (timingSafeEqual 결과)`.
 *
 * 주의:
 *  - 양쪽 모두 빈 입력(길이 0)이면 `true`를 반환한다. 인증 경로에서는
 *    **호출 전에** 0 길이 토큰/키를 반드시 거부하여야 한다. 빈 키 허용은
 *    호출자 책임 영역이다.
 *
 * 인코딩 계약:
 *  - 기본 `encoding`은 'hex'. 'hex' 인코딩일 때만 형식 검증(/^[0-9a-fA-F]*$/)을
 *    수행하여 silent truncation(Buffer.from이 비-hex 문자를 만나 입력을 잘라내는 동작)을
 *    차단한다. 'utf8' 등 다른 인코딩에서는 문자열을 그대로 Buffer로 변환하며
 *    별도 형식 검증은 하지 않는다.
 *
 * @param a 비교 대상 A. 문자열이면 `encoding`으로 Buffer 변환.
 * @param b 비교 대상 B. 문자열이면 `encoding`으로 Buffer 변환.
 * @param encoding 문자열을 Buffer로 변환할 때 사용할 인코딩. 기본 'hex'.
 * @param expectedLength (옵션) 호출자가 토큰/키 길이를 알고 있을 때 지정.
 *                       지정 시 두 입력을 `expectedLength` 바이트로 pad하여
 *                       preamble 비용을 호출별로 고정시킨다. 실제 길이가
 *                       `expectedLength`와 다르면 dummy 비교 후 false를 반환한다.
 *                       **잘못된 값(정수가 아니거나 0 이하)은 `RangeError`를 던진다.**
 *                       조용한 폴백은 의도치 않은 보안 저하를 은폐할 수 있으므로
 *                       호출자가 명시적으로 인식하도록 한다.
 * @returns 두 입력이 완전히 동일하면 true, 그 외 false.
 * @throws {RangeError} `expectedLength`가 지정되었으나 양의 정수가 아닌 경우.
 */
export function timingSafeStringEqual(
    a: string | Buffer,
    b: string | Buffer,
    encoding: BufferEncoding = "hex",
    expectedLength?: number
): boolean {
    // LOW L-2: expectedLength가 지정되었으면 양의 정수여야 함.
    // 0 이하/비정수 값을 조용히 폴백하지 않고 예외로 호출 계약 위반을 드러낸다.
    if (expectedLength !== undefined) {
        if (!Number.isInteger(expectedLength) || expectedLength <= 0) {
            throw new RangeError(
                `timingSafeStringEqual: expectedLength must be a positive integer, got ${String(expectedLength)}`
            );
        }
    }

    // MEDIUM-1: hex 인코딩일 때 silent truncation 방지.
    // Buffer.from(s,'hex')는 비-hex 문자를 만나면 거기서 잘라내므로,
    // 사전에 형식 검증 후 실패 시 dummy 비교 경로로 false를 반환한다.
    const hexValid = (s: string): boolean => /^[0-9a-fA-F]*$/.test(s);
    let formatValid = true;
    if (typeof a === "string" && encoding === "hex" && !hexValid(a)) formatValid = false;
    if (typeof b === "string" && encoding === "hex" && !hexValid(b)) formatValid = false;

    const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a, encoding);
    const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b, encoding);

    // expectedLength 지정 시: 고정 길이 pad → preamble 시간 길이-독립.
    // 미지정 시: 동적 max 길이 pad (기존 동작 유지).
    const targetLen =
        expectedLength !== undefined
            ? expectedLength
            : Math.max(bufA.length, bufB.length, 1);

    const padA = Buffer.alloc(targetLen, 0);
    const padB = Buffer.alloc(targetLen, 0);
    bufA.copy(padA, 0, 0, Math.min(bufA.length, targetLen));
    bufB.copy(padB, 0, 0, Math.min(bufB.length, targetLen));

    // 항상 동일 길이 버퍼에 대해 timingSafeEqual 실행 (상수시간 성질 유지).
    const equalContent = crypto.timingSafeEqual(padA, padB);
    const equalLength = bufA.length === bufB.length;
    const equalExpected =
        expectedLength !== undefined
            ? bufA.length === expectedLength && bufB.length === expectedLength
            : true;

    return formatValid && equalLength && equalExpected && equalContent;
}

export default timingSafeStringEqual;
