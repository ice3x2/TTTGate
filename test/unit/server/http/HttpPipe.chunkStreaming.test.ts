import {HttpPipe, MessageType} from "../../../../src/server/http/HttpPipe";

// #176 — 청크 하나를 다 받을 때까지 쌓으면 큰 청크 응답이 통째로 메모리에 머문다. 받은 만큼 바로 전달한다.
describe("HttpPipe chunked streaming", () => {
    const responsePipe = () => {
        const pipe = new HttpPipe();
        pipe.reset(MessageType.Response);
        const delivered: Buffer[] = [];
        const errors: Error[] = [];
        pipe.onHeaderCallback = () => {};
        pipe.onDataCallback = (data: Buffer) => { delivered.push(Buffer.from(data)); return true; };
        pipe.onEndCallback = () => {};
        pipe.onErrorCallback = (error: Error) => { errors.push(error); };
        return {pipe, delivered, errors};
    };
    const bytes = (list: Buffer[]) => Buffer.concat(list).length;

    it("delivers partial chunk payload as it arrives", () => {
        const {pipe, delivered, errors} = responsePipe();
        pipe.write(Buffer.from("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"));
        pipe.write(Buffer.from((1024 * 1024).toString(16) + "\r\n"));
        pipe.write(Buffer.alloc(100 * 1024, 7));
        expect(errors).toEqual([]);
        expect(bytes(delivered)).toBeGreaterThanOrEqual(100 * 1024);
    });

    it("still rejects a chunk that is not followed by CRLF", () => {
        const {pipe, errors} = responsePipe();
        pipe.write(Buffer.from("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nabcdXY0\r\n\r\n"));
        expect(errors.length).toBe(1);
    });

    it("passes a complete chunked body through unchanged when split into tiny pieces", () => {
        const {pipe, delivered, errors} = responsePipe();
        const raw = Buffer.from("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n");
        for(let i = 0; i < raw.length; i += 3) pipe.write(raw.subarray(i, i + 3));
        expect(errors).toEqual([]);
        expect(Buffer.concat(delivered).toString()).toContain("hello");
        expect(Buffer.concat(delivered).toString()).toContain(" world");
    });
});
