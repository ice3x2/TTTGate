import ConstructorConsumerHandler from "../../../src/util/ConstructorConsumerHandler";

jest.setTimeout(30_000);

const originalStackTraceLimit = Error.stackTraceLimit;

beforeAll(() => {
    Error.stackTraceLimit = 200;
});

afterAll(() => {
    Error.stackTraceLimit = originalStackTraceLimit;
});

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("ConstructorConsumerHandler", () => {
    it("push queues items and consumes them in order after a tick", async () => {
        const log: number[] = [];
        const handler = new ConstructorConsumerHandler<number>((item) => {
            log.push(item);
            return true;
        });

        handler.push(1);
        handler.push(2);
        handler.push(3);
        expect(log).toEqual([]);

        await tick();
        expect(log).toEqual([1, 2, 3]);
    });

    it("pushOnly does not start consumption until tryStart is called", async () => {
        const log: number[] = [];
        const handler = new ConstructorConsumerHandler<number>((item) => {
            log.push(item);
            return true;
        });

        handler.pushOnly(1);
        await tick();
        expect(log).toEqual([]);

        expect(handler.tryStart()).toBe(true);
        await tick();
        expect(log).toEqual([1]);
    });

    it("tryStart returns false while already running in the same tick", () => {
        const handler = new ConstructorConsumerHandler<number>(() => true);
        handler.pushOnly(1);

        expect(handler.tryStart()).toBe(true);
        expect(handler.tryStart()).toBe(false);
    });

    it("pushFront places an item ahead of items queued with pushOnly", async () => {
        const log: number[] = [];
        const handler = new ConstructorConsumerHandler<number>((item) => {
            log.push(item);
            return true;
        });

        handler.pushOnly(2);
        handler.pushFront(1);

        await tick();
        expect(log).toEqual([1, 2]);
    });

    it("a false return pauses consumption, and the paused item can be removed and resumed", async () => {
        const log: number[] = [];
        const onPause = jest.fn();
        const handler = new ConstructorConsumerHandler<number>((item) => {
            log.push(item);
            return item !== 2;
        });
        handler.setOnPause(onPause);

        handler.push(1);
        handler.push(2);
        handler.push(3);

        await tick();
        expect(log).toEqual([1, 2]);
        expect(onPause).toHaveBeenCalledTimes(1);

        expect(handler.removeItem((v) => v === 2)).toEqual([2]);

        expect(handler.tryStart()).toBe(true);
        await tick();
        expect(log).toEqual([1, 2, 3]);
    });

    it("calls onPause when the queue drains and consumption ends", async () => {
        const onPause = jest.fn();
        const handler = new ConstructorConsumerHandler<number>(() => true);
        handler.setOnPause(onPause);

        handler.push(1);
        await tick();

        expect(onPause).toHaveBeenCalledTimes(1);
    });

    it("setStackCutterCount returns the same instance and breaks the call stack at the configured depth", async () => {
        const handler = new ConstructorConsumerHandler<number>(() => true);
        expect(handler.setStackCutterCount(2)).toBe(handler);

        const depths: number[] = [];
        const measuringHandler = new ConstructorConsumerHandler<number>(() => {
            depths.push(new Error().stack!.split("\n").length);
            return true;
        });
        measuringHandler.setStackCutterCount(2);

        [1, 2, 3, 4, 5].forEach((v) => measuringHandler.pushOnly(v));
        measuringHandler.tryStart();

        await tick();

        expect(depths[1]).toBeGreaterThan(depths[0]);
        expect(depths[2]).toBeGreaterThan(depths[1]);
        expect(depths[3]).toBeLessThan(depths[2]);
    });
});
