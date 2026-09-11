/**
 * RFC 4648 §6 Base32 (알파벳 `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`, 패딩 없음).
 * #111 (U4-03) — TOTP 시크릿 표시용. 형식 오류는 예외가 아니라 undefined 로 알린다.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const base32Encode = (bytes: Buffer): string => {
    let bits = 0;
    let value = 0;
    let output = "";
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            output += ALPHABET[(value >>> bits) & 0x1f];
        }
    }
    if (bits > 0) {
        output += ALPHABET[(value << (5 - bits)) & 0x1f];
    }
    return output;
};

export const base32Decode = (text: string): Buffer | undefined => {
    const cleaned = text.toUpperCase().replace(/[=\s]/g, "");
    let bits = 0;
    let value = 0;
    const output: number[] = [];
    for (const ch of cleaned) {
        const index = ALPHABET.indexOf(ch);
        if (index === -1) {
            return undefined;
        }
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            output.push((value >>> bits) & 0xff);
        }
    }
    return Buffer.from(output);
};
