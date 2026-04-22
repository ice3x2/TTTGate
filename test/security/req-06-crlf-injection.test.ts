/**
 * P4-T2 / REQ-06 + REQ-10 — HTTP 헤더 CRLF/NUL 인젝션 차단 + obs-fold 제거 + 재직렬화 재검사.
 *
 * Mock 금지: 실 HttpPipe / 실 HttpUtil 호출. 외부 소켓 불필요.
 *
 * 검증 항목:
 *  (a) 헤더 값에 CR/LF 포함 시 400.
 *  (b) 헤더 name에 RFC 7230 token 이외 문자(공백/콜론 등) 포함 시 400.
 *  (c) 경로(path)에 CR/LF/NUL 포함 시 400.
 *  (d) obs-fold (SP/HTAB 으로 시작하는 continuation line) 요청은 400 + multi-line 코드 미잔존.
 *  (e) convertHttpHeaderToBuffer 재직렬화 경로: 악의적 호스트 치환 결과(`value="a\r\nX-Evil: 1"`)
 *      를 주입하면 재직렬화 시 예외 발생 (response splitting 차단).
 *  (f) 정상 헤더 재직렬화 결과에 `\r\n` 외 위치의 CR/LF 가 존재하지 않는다.
 */
import { HttpPipe, MessageType, HttpRequestHeader } from "../../src/server/http/HttpPipe";
import HttpUtil from "../../src/server/http/HttpUtil";

function makeRequestPipe() {
    const pipe = HttpPipe.createHttpRequestPipe();
    const errors: Error[] = [];
    const headers: HttpRequestHeader[] = [];
    pipe.onErrorCallback = (err) => errors.push(err);
    pipe.onHeaderCallback = (h) => headers.push(h as HttpRequestHeader);
    pipe.onDataCallback = () => true;
    pipe.onEndCallback = () => { /* no-op */ };
    return { pipe, errors, headers };
}

describe("REQ-06 / REQ-10 CRLF/NUL header injection and obs-fold", () => {
    it("(a) 헤더 값에 CR/LF 포함 시 400 (파서 단에서 차단)", () => {
        // HttpPipe 는 \r\n 구분자 기반이므로 원시 스트림에 CR/LF를 심는 대신,
        // splitHeaderBuffer 이후 value trim 에서도 잡히도록 verify.
        // Here we simulate embedded NUL (\0) which passes line split but is injection-class.
        const { pipe, errors, headers } = makeRequestPipe();
        const payload =
            "GET / HTTP/1.1\r\n" +
            "Host: ok.example\r\n" +
            "X-Bad: value\0injected\r\n" +
            "\r\n";
        pipe.write(Buffer.from(payload));
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0].message).toMatch(/400/);
        expect(headers.length).toBe(0);
    });

    it("(b) 헤더 name에 token 외 문자(공백) 포함 시 400", () => {
        const { pipe, errors, headers } = makeRequestPipe();
        const payload =
            "GET / HTTP/1.1\r\n" +
            "Host: ok.example\r\n" +
            "Bad Header: value\r\n" +
            "\r\n";
        pipe.write(Buffer.from(payload));
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0].message).toMatch(/400/);
        expect(errors[0].message).toMatch(/token/i);
        expect(headers.length).toBe(0);
    });

    it("(c) 경로에 NUL 포함 시 400", () => {
        const { pipe, errors, headers } = makeRequestPipe();
        const payload =
            "GET /ok\0evil HTTP/1.1\r\n" +
            "Host: ok.example\r\n" +
            "\r\n";
        pipe.write(Buffer.from(payload));
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0].message).toMatch(/400/);
        expect(headers.length).toBe(0);
    });

    it("(d) obs-fold (continuation line) 요청은 400으로 거부", () => {
        const { pipe, errors, headers } = makeRequestPipe();
        const payload =
            "GET / HTTP/1.1\r\n" +
            "Host: ok.example\r\n" +
            "X-Foo: first-line\r\n" +
            " continuation-line\r\n" +
            "\r\n";
        pipe.write(Buffer.from(payload));
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0].message).toMatch(/400/);
        expect(errors[0].message).toMatch(/obs-fold/i);
        expect(headers.length).toBe(0);
    });

    it("(e) 재직렬화 전 악의적 치환(value에 CRLF) 주입 → convertHttpHeaderToBuffer 예외", () => {
        // 정상 파싱된 요청 헤더를 받아 value 를 강제로 오염시킨 뒤 재직렬화 호출.
        const { pipe, headers } = makeRequestPipe();
        const payload =
            "GET / HTTP/1.1\r\n" +
            "Host: a.example\r\n" +
            "\r\n";
        pipe.write(Buffer.from(payload));
        expect(headers.length).toBe(1);
        const h = headers[0];
        const hostHeader = h.headers.find((nv) => nv.name.toLowerCase() === "host")!;
        // rewriteHostInTextBody / 응답 헤더 재작성 경로에서 악의적 호스트 치환이 들어갔다고 가정.
        hostHeader.value = "evil.example\r\nX-Evil: 1";
        expect(() => HttpUtil.convertHttpHeaderToBuffer(h)).toThrow(/REQ-10|CR\/LF/i);
    });

    it("(f) 정상 헤더 재직렬화 결과는 구분자 위치(\\r\\n) 외에 CR/LF를 포함하지 않는다", () => {
        const { pipe, headers } = makeRequestPipe();
        const payload =
            "GET /path HTTP/1.1\r\n" +
            "Host: a.example\r\n" +
            "X-Foo: bar\r\n" +
            "\r\n";
        pipe.write(Buffer.from(payload));
        expect(headers.length).toBe(1);
        const buf = HttpUtil.convertHttpHeaderToBuffer(headers[0]);
        const s = buf.toString("utf8");
        // \r\n 구분자 위치를 제거한 뒤에는 CR/LF 가 전혀 없어야 함.
        const stripped = s.split("\r\n").join("");
        expect(/[\r\n]/.test(stripped)).toBe(false);
    });

    it("(g) HttpPipe 소스에서 obs-fold를 '이전 헤더의 계속'으로 붙이는 로직이 제거됨 (정적 검사)", () => {
        // obs-fold 수용 코드가 남아있지 않은지 파일 내용 정적 검사.
        const fs = require("fs");
        const path = require("path");
        const src = fs.readFileSync(path.resolve(__dirname, "../../src/server/http/HttpPipe.ts"), "utf8");
        // 이전 코드: `currentHeader.value += ' ' + header.toString().trim();` 형태의 계속-연결 코드가 제거되었어야 함.
        expect(src).not.toMatch(/currentHeader\.value\s*\+=/);
    });
});
