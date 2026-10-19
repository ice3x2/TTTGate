import {EventEmitter} from "events";
import {SocketHandler} from "../../../src/util/SocketHandler";
import SocketState from "../../../src/util/SocketState";
import {ResourcePolicyRegistry} from "../../../src/util/ResourcePolicy";
import {applyTestRoot, cleanupTestRoot, createTestRoot, TestRoot} from "../../helpers/runtime";
import {collectResourceStats} from "../../helpers/resourceStats";

class SlowWritableSocket extends EventEmitter {
    public remoteAddress = "127.0.0.1";
    public remotePort = 4010;
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
        // never flush to keep the handler in a backpressured state
        return false;
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

describe("SocketHandler resource guardrails", () => {
    let testRoot: TestRoot;

    beforeEach(async () => {
        testRoot = await createTestRoot("socket-handler-resource");
        applyTestRoot(testRoot.rootDir);
        ResourcePolicyRegistry.configure({
            fileCachePerHandlerLimitBytes: 8 * 1024,
            fileCacheGlobalLimitBytes: 8 * 1024
        });
    });

    afterEach(async () => {
        await cleanupTestRoot(testRoot);
    });

    it("fails closed and cleans cache files when spill quota is exceeded", () => {
        const states: SocketState[] = [];
        const handler = SocketHandler.bound({
            socket: new SlowWritableSocket() as any,
            port: 9126,
            addr: "127.0.0.1",
            tls: false,
            keepAlive: 0
        }, (_handler, state) => {
            states.push(state);
        });
        handler.setBufferSizeLimit(1024);

        const chunk = Buffer.alloc(4 * 1024, 1);

        handler.sendData(chunk);
        handler.sendData(chunk);
        handler.sendData(chunk);
        handler.sendData(chunk);

        expect(handler.isEnd()).toBe(true);
        expect(states).toContain(SocketState.Closed);
        expect(SocketHandler.globalFileCacheSize).toBe(0);
        expect(collectResourceStats().serverCacheBytes).toBe(0);
    });
});
