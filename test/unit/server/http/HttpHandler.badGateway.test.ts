import HttpHandler from "../../../../src/server/http/HttpHandler";
import SocketState from "../../../../src/util/SocketState";
import {TunnelingOption} from "../../../../src/types/TunnelingOption";
import {cleanupCreatedInstances} from "../../../helpers/createdInstances";

// #284 — 대상 서버에 닿지 못한 세션은 응답 없이 닫지 않고 502 Bad Gateway 로 답한다.
type MockSocketHandler = {
    id: number;
    socket: {remoteAddress: string, remotePort: number};
    breakBufferFlush: boolean;
    writes: Buffer[];
    onSocketEvent?: (handler: any, state: any, data?: any) => void;
    setBundle(key: string, value: any): void;
    getBundle(key: string): any;
    deleteBundle(key: string): void;
    isEnd(): boolean;
    isSecure(): boolean;
    sendData(data: Buffer, callback?: (client: any, success: boolean) => void): void;
    destroy(): void;
    end_(): void;
    setTimeout(): void;
    isOutputDrained: boolean;
};

const createMockSocketHandler = (): MockSocketHandler => {
    const bundles = new Map<string, any>();

    return {
        id: 1,
        socket: {
            remoteAddress: "127.0.0.1",
            remotePort: 12345
        },
        breakBufferFlush: false,
        writes: [],
        setBundle(key: string, value: any) {
            bundles.set(key, value);
        },
        getBundle(key: string): any {
            return bundles.get(key);
        },
        deleteBundle(key: string): void {
            bundles.delete(key);
        },
        isEnd(): boolean {
            return false;
        },
        isSecure(): boolean {
            return false;
        },
        sendData(data: Buffer, callback?: (client: any, success: boolean) => void): void {
            this.writes.push(Buffer.from(data));
            callback?.(this, true);
        },
        destroy: jest.fn(),
        end_: jest.fn(),
        setTimeout: jest.fn(),
        isOutputDrained: true
    };
};

const OPTION: TunnelingOption = {forwardPort: 8080, protocol: "http", destinationAddress: "internal.example", destinationPort: 80, keepAlive: 0};

const setup = () => {
    const socketHandler = createMockSocketHandler();
    const handler = HttpHandler.create(socketHandler as any, OPTION);
    const forwarded: Buffer[] = [];
    handler.onSocketEvent = (_handler: any, state: any, data?: any) => { if(state === SocketState.Receive && data) forwarded.push(Buffer.from(data)); };
    const feed = (text: string) => socketHandler.onSocketEvent!(socketHandler, SocketState.Receive, Buffer.from(text));
    const written = () => Buffer.concat(socketHandler.writes).toString("latin1");
    return {socketHandler, handler, feed, written, forwarded};
};

const REQUEST = "GET / HTTP/1.1\r\nHost: public.example\r\n\r\n";

cleanupCreatedInstances(HttpHandler, (handler) => handler.destroy());

test("a pending request gets 502 when the destination cannot be reached", () => {
    const {socketHandler, handler, feed, written} = setup();
    feed(REQUEST);
    expect(handler.failToReachDestination()).toBe(true);
    expect(written()).toMatch(/^HTTP\/1\.1 502 Bad Gateway\r\n/);
    expect(written()).toContain("Connection: close\r\n");
    expect(socketHandler.end_).toHaveBeenCalled();
});

test("a request that arrives after the failure gets 502 and is not forwarded (AC-3)", () => {
    const {socketHandler, handler, feed, written, forwarded} = setup();
    expect(handler.failToReachDestination()).toBe(true);
    expect(written()).toBe("");
    expect(socketHandler.end_).not.toHaveBeenCalled();
    feed(REQUEST);
    expect(written()).toMatch(/^HTTP\/1\.1 502 Bad Gateway\r\n/);
    expect(forwarded).toEqual([]);
    expect(socketHandler.end_).toHaveBeenCalled();
});

test("the 502 body does not reveal the destination (REQ-4)", () => {
    const {handler, feed, written} = setup();
    feed(REQUEST);
    handler.failToReachDestination();
    const text = written();
    const [head, body] = text.split("\r\n\r\n");
    expect(Number(/Content-Length: (\d+)/.exec(head)![1])).toBe(Buffer.byteLength(body));
    expect(body.length).toBeGreaterThan(0);
    expect(text).not.toContain("internal.example");
    expect(text).not.toContain(":80");
});

test("a connection that already received part of a response is not answered with 502 (AC-4)", () => {
    const {handler, feed, written} = setup();
    feed(REQUEST);
    handler.sendData(Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nhel"));
    const before = written();
    expect(handler.failToReachDestination()).toBe(false);
    expect(written()).toBe(before);
    expect(written()).not.toContain("502");
});

// 실패한 뒤 본문이 붙은 요청이 한 덩어리로 와도 본문을 대상 쪽으로 넘기지 않는다(REQ-3).
test("a request body that arrives after the failure is not forwarded (REQ-3)", () => {
    const {handler, feed, written, forwarded} = setup();
    expect(handler.failToReachDestination()).toBe(true);
    feed("POST / HTTP/1.1\r\nHost: public.example\r\nContent-Length: 5\r\n\r\nhello");
    expect(written()).toMatch(/^HTTP\/1\.1 502 Bad Gateway\r\n/);
    expect(forwarded).toEqual([]);
});

// 요청이 끝내 오지 않으면 기존 요청 헤더 기한(408)으로 닫는다. 대기가 끝없이 이어지지 않는다(REQ-2).
test("without a request the failed connection still closes at the header deadline with 408 (REQ-2)", () => {
    jest.useFakeTimers();
    try {
        const {socketHandler, handler, written} = setup();
        expect(handler.failToReachDestination()).toBe(true);
        jest.advanceTimersByTime(30_001);
        expect(written()).toMatch(/^HTTP\/1\.1 408 Request Timeout\r\n/);
        expect(socketHandler.end_).toHaveBeenCalled();
    } finally {
        jest.useRealTimers();
    }
});

// HEAD 응답에는 본문이 없어야 한다. 길이 헤더는 GET 과 같게 둔다.
test("a HEAD request gets a 502 without a body", () => {
    const {handler, feed, written} = setup();
    feed("HEAD / HTTP/1.1\r\nHost: public.example\r\n\r\n");
    handler.failToReachDestination();
    const [head, body] = written().split("\r\n\r\n");
    expect(head).toMatch(/^HTTP\/1\.1 502 Bad Gateway/);
    expect(Number(/Content-Length: (\d+)/.exec(head)![1])).toBeGreaterThan(0);
    expect(body).toBe("");
});
