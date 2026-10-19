import {HttpPipe} from "../../../../src/server/http/HttpPipe";
import HttpUtil from "../../../../src/server/http/HttpUtil";

// #168 — 요청 경계를 백엔드와 다르게 해석하면 프록시 쪽 검사를 우회할 수 있다. path 의 Host 문자열을 통째로 바꾸면 요청이 훼손된다.
describe("HTTP request parsing and target rewrite", () => {
    const parse = (contentLength: string): {errors: Error[]; headers: number} => {
        const pipe = HttpPipe.createHttpRequestPipe();
        const errors: Error[] = [];
        let headers = 0;
        pipe.onErrorCallback = (error: Error) => { errors.push(error); };
        pipe.onHeaderCallback = () => { headers++; };
        pipe.onDataCallback = () => false;
        pipe.onEndCallback = () => {};
        pipe.write(Buffer.from(`POST / HTTP/1.1\r\nHost: example.com\r\nContent-Length: ${contentLength}\r\n\r\nhello`));
        return {errors, headers};
    };

    it.each(["10abc", "-1", "+5", "5.0", "0x5", "1e1", ""])("rejects Content-Length %p", (value) => {
        const result = parse(value);
        expect({value, errors: result.errors.length, headers: result.headers}).toEqual({value, errors: 1, headers: 0});
    });

    it("accepts a plain decimal Content-Length", () => {
        expect(parse("5")).toEqual({errors: [], headers: 1});
    });

    it("rewrites only the authority of an absolute-form target", () => {
        expect(HttpUtil.rewriteRequestTargetHost("http://public.example.com/a?next=http://public.example.com/b", "public.example.com", "10.0.0.5"))
            .toBe("http://10.0.0.5/a?next=http://public.example.com/b");
        expect(HttpUtil.rewriteRequestTargetHost("/login?next=https://public.example.com/", "public.example.com", "10.0.0.5"))
            .toBe("/login?next=https://public.example.com/");
        expect(HttpUtil.rewriteRequestTargetHost("http://other.example.com/", "public.example.com", "10.0.0.5"))
            .toBe("http://other.example.com/");
    });
});
