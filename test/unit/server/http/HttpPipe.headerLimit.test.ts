import {HttpPipe} from "../../../../src/server/http/HttpPipe";

// #166 — 인증 없는 외부 연결이 헤더를 8MiB 까지 쌓을 수 있었다. 헤더 상한을 64KiB 로 낮춘다.
describe("HttpPipe header limit", () => {
    const feed = (size: number, chunk = 4096): {errors: Error[]; headers: number} => {
        const pipe = HttpPipe.createHttpRequestPipe();
        const errors: Error[] = [];
        let headers = 0;
        pipe.onErrorCallback = (error: Error) => { errors.push(error); };
        pipe.onHeaderCallback = () => { headers++; };
        pipe.onDataCallback = () => {};
        pipe.onEndCallback = () => {};
        const head = Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\nX-Pad: ");
        const pad = Buffer.alloc(size, "a");
        const all = Buffer.concat([head, pad]);
        for(let offset = 0; offset < all.length && errors.length === 0; offset += chunk) {
            pipe.write(all.subarray(offset, offset + chunk));
        }
        if(errors.length === 0) pipe.write(Buffer.from("\r\n\r\n"));
        return {errors, headers};
    };

    it("rejects a header larger than 64KiB before it completes", () => {
        const result = feed(70 * 1024);
        expect(result.errors.length).toBe(1);
        expect(result.headers).toBe(0);
    });

    it("accepts a large header within the limit", () => {
        const result = feed(32 * 1024);
        expect(result.errors).toEqual([]);
        expect(result.headers).toBe(1);
    });

    it("still finds the header end when CRLFCRLF is split across chunks", () => {
        const result = feed(10_000, 7);
        expect(result.errors).toEqual([]);
        expect(result.headers).toBe(1);
    });
});
