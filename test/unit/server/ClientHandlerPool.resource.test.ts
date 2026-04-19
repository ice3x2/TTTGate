import {EventEmitter} from "events";
import {ClientHandlerPool} from "../../../src/server/ClientHandlerPool";
import {SocketHandler} from "../../../src/util/SocketHandler";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";

class FastWritableSocket extends EventEmitter {
    public remoteAddress = "127.0.0.1";
    public remotePort = 5001;
    public localAddress = "127.0.0.1";

    public setNoDelay(): this {
        return this;
    }

    public setKeepAlive(): this {
        return this;
    }

    public setTimeout(): this {
        return this;
    }

    public pause(): this {
        return this;
    }

    public resume(): this {
        return this;
    }

    public write(_buffer: Buffer, callback?: (error?: Error | null) => void): boolean {
        callback?.(null);
        return true;
    }

    public end(): this {
        this.emit("end");
        this.emit("close");
        return this;
    }

    public destroy(): this {
        this.emit("close");
        return this;
    }
}

describe("ClientHandlerPool queue containment", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("client-handler-pool");
        applyTestRoot(testRoot.rootDir);
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("fails only the offending waiting session when the pending queue exceeds the session budget", () => {
        const controlHandler = SocketHandler.bound({
            socket: new FastWritableSocket() as any,
            port: 9126,
            addr: "127.0.0.1",
            tls: false,
            keepAlive: 0
        }, () => {});
        const pool = ClientHandlerPool.create(1, controlHandler);
        const onSessionClose = jest.fn();
        pool.onSessionCloseCallback = onSessionClose;

        pool.sendConnectEndPoint(100, {
            host: "127.0.0.1",
            port: 8080,
            tls: false,
            bufferLimit: 1024
        });

        expect(pool.sendBuffer(100, Buffer.alloc(900))).toBe(true);
        expect(pool.sendBuffer(100, Buffer.alloc(300))).toBe(false);
        expect(onSessionClose).toHaveBeenCalledWith(100, 0);
        expect(pool.pendingSessionCount).toBe(0);
    });
});
