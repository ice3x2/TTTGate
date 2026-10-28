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
