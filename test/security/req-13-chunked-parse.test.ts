/**
 * P4-T3 / REQ-13 — chunked size 엄격 파싱.
 *
 * parseInt('0xFF', 16) === 0, parseInt('-1', 16) === -1, parseInt('+FF', 16) === 255 등
 * parseInt의 관용적 동작이 요청 바운더리 조작에 악용될 수 있음. 정규식 사전 검증으로 차단.
 *
 * 검증:
 *  (a) '0xFF' → 400 (prefix 포함 시 거부).
 *  (b) '-1'   → 400 (음수/부호 거부).
 *  (c) '+FF'  → 400 (양수 부호 거부).
 *  (d) 'ZZ'   → 400 (hex 외 문자 거부).
 *  (e) 정상 'a' (10) 및 ';ext' (chunk extension) 는 허용.
 */
import { HttpPipe, HttpRequestHeader } from "../../src/server/http/HttpPipe";

function makeRequestPipe() {
    const pipe = HttpPipe.createHttpRequestPipe();
    const errors: Error[] = [];
    const headers: HttpRequestHeader[] = [];
    const data: Buffer[] = [];
    let ended = false;
    pipe.onErrorCallback = (err) => errors.push(err);
    pipe.onHeaderCallback = (h) => headers.push(h as HttpRequestHeader);
    pipe.onDataCallback = (d) => { data.push(Buffer.from(d)); return true; };
    pipe.onEndCallback = () => { ended = true; };
    return { pipe, errors, headers, data, isEnded: () => ended };
}

function chunkedRequest(sizeLine: string, bodyAfterSize: string = ""): string {
    return (
        "POST /chunked HTTP/1.1\r\n" +
        "Host: ok.example\r\n" +
        "Transfer-Encoding: chunked\r\n" +
        "\r\n" +
        sizeLine + "\r\n" +
        bodyAfterSize
    );
}

describe("REQ-13 chunked size strict parse", () => {
    it("(a) '0xFF' prefix 포함 크기는 400으로 거부", () => {
        const { pipe, errors } = makeRequestPipe();
        pipe.write(Buffer.from(chunkedRequest("0xFF")));
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0].message).toMatch(/400|chunked size/i);
    });

    it("(b) '-1' 음수는 400으로 거부", () => {
        const { pipe, errors } = makeRequestPipe();
        pipe.write(Buffer.from(chunkedRequest("-1")));
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0].message).toMatch(/400|chunked size/i);
    });

    it("(c) '+FF' 부호 포함은 400으로 거부", () => {
        const { pipe, errors } = makeRequestPipe();
        pipe.write(Buffer.from(chunkedRequest("+FF")));
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0].message).toMatch(/400|chunked size/i);
    });

    it("(d) hex가 아닌 문자('ZZ')는 400으로 거부", () => {
        const { pipe, errors } = makeRequestPipe();
        pipe.write(Buffer.from(chunkedRequest("ZZ")));
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0].message).toMatch(/400|chunked size/i);
    });

    it("(e) 정상 'a' (10바이트) + chunk extension 은 허용", () => {
        const { pipe, errors, isEnded } = makeRequestPipe();
        // 10바이트 본문 + 종료 0-chunk.
        const body = "0123456789";
        const payload = chunkedRequest("a;name=value", body + "\r\n0\r\n\r\n");
        pipe.write(Buffer.from(payload));
        expect(errors.length).toBe(0);
        expect(isEnded()).toBe(true);
    });
});
