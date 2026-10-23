/**
 * #246 — chunk 크기 줄의 길이 상한.
 *
 * 크기 줄(크기·확장·CRLF 앞)은 CRLF 가 올 때까지 버퍼에 쌓인다. 상한이 없으면 연결 하나가 줄바꿈 없이
 * 보내는 바이트만큼 메모리를 쓴다. 요청 파이프와 응답 파이프에 같은 코드가 쓰이므로 둘 다 확인한다.
 */
import {HttpPipe, MessageType} from "../../src/server/http/HttpPipe";

const LIMIT = 64 * 1024;
const PIECE = 16 * 1024;

type Pipe = HttpPipe;
/** HttpHandler 의 응답 파이프와 같은 방식으로 만든다. */
const createResponsePipe = (): HttpPipe => { const pipe = new HttpPipe(); pipe.reset(MessageType.Response); return pipe; };
const collect = (pipe: Pipe) => {
    const errors: Error[] = [];
    const data: Buffer[] = [];
    let ended = false;
    pipe.onErrorCallback = (error) => errors.push(error);
    pipe.onHeaderCallback = () => {};
    pipe.onDataCallback = (chunk) => { data.push(Buffer.from(chunk)); return true; };
    pipe.onEndCallback = () => { ended = true; };
    return {errors, body: () => Buffer.concat(data).toString(), ended: () => ended};
};

const REQUEST_HEAD = "POST /up HTTP/1.1\r\nHost: ok.example\r\nTransfer-Encoding: chunked\r\n\r\n";
const RESPONSE_HEAD = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n";

/** 오류가 날 때까지(최대 total 바이트) 같은 조각을 써 넣고, 그동안 본 가장 큰 버퍼 크기를 돌려준다. */
const flood = (pipe: Pipe, errors: Error[], piece: Buffer, total: number): number => {
    let maxBuffer = 0;
    for(let written = 0; written < total && errors.length === 0; written += piece.length) {
        pipe.write(piece);
        maxBuffer = Math.max(maxBuffer, pipe.bufferSize);
    }
    return maxBuffer;
};

describe("#246 chunk-size line length limit", () => {
    test.each([
        ["request", () => HttpPipe.createHttpRequestPipe(), REQUEST_HEAD],
        ["response", createResponsePipe, RESPONSE_HEAD],
    ])("REQ-1/AC-1 (%s) an endless run of hex digits is rejected once it passes the limit", (_side, create, head) => {
        const pipe = create();
        const {errors} = collect(pipe);
        pipe.write(Buffer.from(head));
        const maxBuffer = flood(pipe, errors, Buffer.alloc(PIECE, "1"), 1024 * 1024);
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(maxBuffer).toBeLessThanOrEqual(LIMIT + PIECE);
    });

    test.each([
        ["request", () => HttpPipe.createHttpRequestPipe(), REQUEST_HEAD],
        ["response", createResponsePipe, RESPONSE_HEAD],
    ])("REQ-1 (%s) an endless chunk extension is rejected once the line passes the limit", (_side, create, head) => {
        const pipe = create();
        const {errors} = collect(pipe);
        pipe.write(Buffer.from(head + "1;ext="));
        const maxBuffer = flood(pipe, errors, Buffer.alloc(PIECE, "a"), 1024 * 1024);
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(maxBuffer).toBeLessThanOrEqual(LIMIT + PIECE);
    });

    test("REQ-1 a complete size line longer than the limit is rejected even when it arrives with its CRLF in one write", () => {
        const pipe = HttpPipe.createHttpRequestPipe();
        const {errors} = collect(pipe);
        pipe.write(Buffer.from(REQUEST_HEAD + "1;e=" + "x".repeat(LIMIT + 1024) + "\r\na\r\n0\r\n\r\n"));
        expect(errors.length).toBe(1);
        expect(errors[0].message).toMatch(/chunked size line too large/);
    });

    test("REQ-2/AC-2 a byte that cannot be part of a chunk size is rejected before the CRLF arrives", () => {
        const pipe = HttpPipe.createHttpRequestPipe();
        const {errors} = collect(pipe);
        pipe.write(Buffer.from(REQUEST_HEAD + "Z"));
        expect(errors.length).toBe(1);
        expect(errors[0].message).toMatch(/chunk/i);
    });

    test("REQ-4/AC-4 a valid chunked request split into single bytes, with extensions and whitespace, still passes", () => {
        const pipe = HttpPipe.createHttpRequestPipe();
        pipe.setDeliverPureData(true);
        const {errors, body, ended} = collect(pipe);
        const message = REQUEST_HEAD + "5;name=\"v a\"\r\nhello\r\n6 \r\n world\r\nA\t;x\r\n0123456789\r\n0\r\n\r\n";
        for(const byte of Buffer.from(message)) pipe.write(Buffer.from([byte]));
        expect(errors).toEqual([]);
        expect(body()).toBe("hello world0123456789");
        expect(ended()).toBe(true);
    });

    test("REQ-4 a size line just under the limit (long extension) is still accepted", () => {
        const pipe = HttpPipe.createHttpRequestPipe();
        pipe.setDeliverPureData(true);
        const {errors, body, ended} = collect(pipe);
        const extension = ";e=" + "x".repeat(LIMIT - 16);
        pipe.write(Buffer.from(REQUEST_HEAD + "3" + extension + "\r\nabc\r\n0\r\n\r\n"));
        expect(errors).toEqual([]);
        expect(body()).toBe("abc");
        expect(ended()).toBe(true);
    });

    // 앞의 빈 줄(CRLF)은 한 번만 넘긴다. CRLF 만 끝없이 보내면 크기 줄 검사를 비켜 가므로 오류로 본다.
    test.each([
        ["request after the head", () => HttpPipe.createHttpRequestPipe(), REQUEST_HEAD],
        ["response after the head", createResponsePipe, RESPONSE_HEAD],
        ["request after a chunk", () => HttpPipe.createHttpRequestPipe(), REQUEST_HEAD + "1\r\na\r\n"],
    ])("REQ-1 (%s) an endless run of empty lines is rejected and does not grow the buffer", (_side, create, head) => {
        const pipe = create();
        const {errors} = collect(pipe);
        pipe.write(Buffer.from(head));
        const maxBuffer = flood(pipe, errors, Buffer.from("\r\n".repeat(PIECE / 2)), 1024 * 1024);
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(maxBuffer).toBeLessThanOrEqual(LIMIT + PIECE);
    });

    // 같은 바이트는 TCP 가 어떻게 나눠 보내든 같은 결과여야 한다.
    test.each([
        ["a vertical tab before the size", "\x0b5\r\nhello\r\n0\r\n\r\n"],
        ["a space before the size", " 5\r\nhello\r\n0\r\n\r\n"],
        ["a bare CR inside the size", "5\r5\r\nhello\r\n0\r\n\r\n"],
        ["a bare LF inside an extension", "5;a\nX\r\nhello\r\n0\r\n\r\n"],
        ["a NUL inside an extension", "5;a\x00\r\nhello\r\n0\r\n\r\n"],
    ])("REQ-2 %s is rejected both in one write and byte by byte", (_label, chunkedBody) => {
        for(const split of [false, true]) {
            const pipe = HttpPipe.createHttpRequestPipe();
            const {errors} = collect(pipe);
            pipe.write(Buffer.from(REQUEST_HEAD));
            const bytes = Buffer.from(chunkedBody, "latin1");
            if(split) { for(const byte of bytes) pipe.write(Buffer.from([byte])); } else pipe.write(bytes);
            expect({split, errors: errors.length}).toEqual({split, errors: 1});
        }
    });

    // 크기 줄 검사는 이미 본 바이트를 다시 보지 않는다. 파이프는 쓰기마다 버퍼를 이어 붙이므로(Buffer.concat)
    // 그 비용은 피할 수 없다. 1바이트씩 64KiB 를 보낼 때 검사가 더하는 비용이 이어 붙이기 비용의 몇 배를 넘지 않아야 한다.
    // (다시 훑으면 이어 붙이기 비용의 10배가 넘는다.)
    test("REQ-1 checking a size line that arrives one byte at a time does not rescan it on every write", () => {
        const one = Buffer.from([0x31]);
        const concatOnly = () => {
            let buffer = Buffer.alloc(0);
            const started = process.hrtime.bigint();
            for(let n = 0; n < LIMIT; n++) buffer = Buffer.concat([buffer, one]);
            return Number(process.hrtime.bigint() - started) / 1e6;
        };
        const sizeLineOneByteAtATime = () => {
            const pipe = HttpPipe.createHttpRequestPipe();
            const {errors} = collect(pipe);
            pipe.write(Buffer.from(REQUEST_HEAD));
            const started = process.hrtime.bigint();
            for(let n = 0; n < LIMIT + 8 && errors.length === 0; n++) pipe.write(one);
            const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
            expect(errors.length).toBe(1);
            return elapsed;
        };
        concatOnly(); // 데우기
        const baseline = concatOnly();
        const elapsed = sizeLineOneByteAtATime();
        expect(elapsed).toBeLessThan(baseline * 4 + 200);
    });

    // 앞의 빈 줄은 쓰기를 나눠 보내도 한 번만 넘긴다.
    test("REQ-1 a second empty line is rejected even when each empty line arrives in its own write", () => {
        const pipe = HttpPipe.createHttpRequestPipe();
        const {errors} = collect(pipe);
        pipe.write(Buffer.from(REQUEST_HEAD));
        pipe.write(Buffer.from("\r\n"));
        expect(errors.length).toBe(0);
        pipe.write(Buffer.from("\r\n"));
        expect(errors.length).toBe(1);
    });

    // 오류가 난 뒤의 쓰기는 버리고, 같은 오류를 다시 알리지 않는다.
    test("after a size-line error, later writes are ignored and the error is reported once", () => {
        const pipe = HttpPipe.createHttpRequestPipe();
        const {errors} = collect(pipe);
        pipe.write(Buffer.from(REQUEST_HEAD + "Z"));
        pipe.write(Buffer.from("more"));
        pipe.write(Buffer.from("and more"));
        pipe.endInput();
        expect(errors.length).toBe(1);
        expect(pipe.bufferSize).toBeLessThanOrEqual(REQUEST_HEAD.length + 1);
    });

    // 정확히 셀 수 없는 크기(2^53 이상)는 받지 않는다. 받으면 터널과 백엔드가 청크 경계를 다르게 본다.
    test("a chunk size that is not a safe integer is rejected, while leading zeros are still accepted", () => {
        const huge = HttpPipe.createHttpRequestPipe();
        const hugeResult = collect(huge);
        huge.write(Buffer.from(REQUEST_HEAD + "FFFFFFFFFFFFFFFFFFFFFFFF\r\nabc"));
        expect(hugeResult.errors.length).toBe(1);

        const padded = HttpPipe.createHttpRequestPipe();
        padded.setDeliverPureData(true);
        const paddedResult = collect(padded);
        padded.write(Buffer.from(REQUEST_HEAD + "0000000000000000000000003\r\nabc\r\n0\r\n\r\n"));
        expect(paddedResult.errors).toEqual([]);
        expect(paddedResult.body()).toBe("abc");
    });

    // write() 가 재귀 예산 때문에 미뤄 둔 바이트를 endInput() 이 처리하다 오류가 나도 한 번만 알린다.
    test("an error found while endInput() finishes deferred bytes is reported once", () => {
        const pipe = HttpPipe.createHttpRequestPipe();
        const {errors} = collect(pipe);
        pipe.write(Buffer.from(REQUEST_HEAD + "1\r\na\r\n".repeat(2000) + "Z\r\n"));
        pipe.endInput();
        expect(errors.length).toBe(1);
        expect(errors[0].message).toMatch(/chunked size line/);
    });

    // 상한 경계는 줄 끝의 CR 이 어느 쓰기에 실려 오든 같다(CRLF 는 줄 길이에 넣지 않는다).
    test("a size line of exactly the limit is accepted however its CRLF is split", () => {
        const line = "3;e=" + "x".repeat(LIMIT - 4);
        for(const split of [false, true]) {
            const pipe = HttpPipe.createHttpRequestPipe();
            pipe.setDeliverPureData(true);
            const {errors, body} = collect(pipe);
            pipe.write(Buffer.from(REQUEST_HEAD));
            if(split) { pipe.write(Buffer.from(line + "\r")); pipe.write(Buffer.from("\nabc\r\n0\r\n\r\n")); }
            else pipe.write(Buffer.from(line + "\r\nabc\r\n0\r\n\r\n"));
            expect({split, errors: errors.length, body: body()}).toEqual({split, errors: 0, body: "abc"});
        }
    });
});
