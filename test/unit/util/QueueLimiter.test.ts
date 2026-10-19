import {QueueLimiterRegistry} from "../../../src/util/QueueLimiter";

describe("QueueLimiter baseline seam", () => {
    afterEach(() => {
        QueueLimiterRegistry.reset();
    });

    it("keeps the current spill-to-file decision contract", () => {
        const shouldSpill = QueueLimiterRegistry.current().shouldSpillToFile({
            incomingSize: 32,
            localBufferedBytes: 96,
            localBufferedLimit: 100,
            globalBufferedBytes: 64,
            globalBufferedLimit: 1000
        });

        expect(shouldSpill).toBe(true);
    });

    it("still enforces the global limit when the local limit is unsafe override", () => {
        const shouldSpill = QueueLimiterRegistry.current().shouldSpillToFile({
            incomingSize: 64,
            localBufferedBytes: 0,
            localBufferedLimit: -1,
            globalBufferedBytes: 80,
            globalBufferedLimit: 100
        });

        expect(shouldSpill).toBe(true);
    });

    it("can be overridden by tests without touching SocketHandler", () => {
        QueueLimiterRegistry.configure({
            shouldSpillToFile() {
                return false;
            }
        });

        expect(QueueLimiterRegistry.current().shouldSpillToFile({
            incomingSize: 1000,
            localBufferedBytes: 1000,
            localBufferedLimit: 1,
            globalBufferedBytes: 1000,
            globalBufferedLimit: 1
        })).toBe(false);
    });
});
