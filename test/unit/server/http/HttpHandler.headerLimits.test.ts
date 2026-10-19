import HttpHandler from "../../../../src/server/http/HttpHandler";
import SocketState from "../../../../src/util/SocketState";
import {TunnelingOption} from "../../../../src/types/TunnelingOption";
import {cleanupCreatedInstances} from "../../../helpers/createdInstances";

// #166 — 헤더 상한을 넘으면 431, 첫 헤더가 기한 안에 오지 않으면 408 로 닫는다.
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
    const feed = (text: string | Buffer) => socketHandler.onSocketEvent!(socketHandler, SocketState.Receive, Buffer.isBuffer(text) ? text : Buffer.from(text));
    const written = () => Buffer.concat(socketHandler.writes).toString("latin1");
    return {socketHandler, handler, feed, written};
};

cleanupCreatedInstances(HttpHandler, (handler) => handler.destroy());

describe("HttpHandler request head limits", () => {
    afterEach(() => { jest.useRealTimers(); });

    it("answers 431 and closes when the request header exceeds the limit", () => {
        const {socketHandler, feed, written} = setup();
        feed("GET / HTTP/1.1\r\nHost: example.com\r\nX-Pad: ");
        for(let i = 0; i < 20; i++) feed(Buffer.alloc(4096, 97));
        expect(written()).toMatch(/^HTTP\/1\.1 431 /);
        expect(socketHandler.end_).toHaveBeenCalled();
    });

    it("answers 408 when the first request header does not arrive in time", () => {
        jest.useFakeTimers();
        const {socketHandler, feed, written} = setup();
        feed("GET / HTTP/1.1\r\nHost: exa");
        jest.advanceTimersByTime(30_001);
        expect(written()).toMatch(/^HTTP\/1\.1 408 /);
        expect(socketHandler.end_).toHaveBeenCalled();
    });

    it("does not time out once the request header has arrived", () => {
        jest.useFakeTimers();
        const {socketHandler, feed, written} = setup();
        feed("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n");
        jest.advanceTimersByTime(60_000);
        expect(written()).not.toMatch(/408/);
        expect(socketHandler.end_).not.toHaveBeenCalled();
    });
});
