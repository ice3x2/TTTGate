import Dequeue from "../../../src/util/Dequeue";

describe("Dequeue", () => {
    it("supports push/pop from both ends in FIFO/LIFO order", () => {
        const dequeue = new Dequeue<number>();
        dequeue.pushBack(1);
        dequeue.pushBack(2);
        dequeue.pushFront(0);

        expect(dequeue.size()).toBe(3);
        expect(dequeue.front()).toBe(0);
        expect(dequeue.back()).toBe(2);
        expect(dequeue.popFront()).toBe(0);
        expect(dequeue.popBack()).toBe(2);
        expect(dequeue.size()).toBe(1);
    });

    it("returns undefined from an empty queue without throwing", () => {
        const dequeue = new Dequeue<number>();

        expect(dequeue.front()).toBeUndefined();
        expect(dequeue.back()).toBeUndefined();
        expect(dequeue.popFront()).toBeUndefined();
        expect(dequeue.popBack()).toBeUndefined();
        expect(dequeue.isEmpty()).toBe(true);
    });

    it("remove extracts matching items in order and preserves the remaining order", () => {
        const dequeue = new Dequeue<number>();
        [1, 2, 3, 4, 5].forEach((v) => dequeue.pushBack(v));

        const removed = dequeue.remove((v) => v % 2 === 0);
        expect(removed).toEqual([2, 4]);

        const remaining: number[] = [];
        while (!dequeue.isEmpty()) {
            remaining.push(dequeue.popFront()!);
        }
        expect(remaining).toEqual([1, 3, 5]);
    });

    it("remove returns an empty array and keeps the size when nothing matches", () => {
        const dequeue = new Dequeue<number>();
        [1, 2, 3].forEach((v) => dequeue.pushBack(v));

        expect(dequeue.remove(() => false)).toEqual([]);
        expect(dequeue.size()).toBe(3);
    });

    it("clear empties the queue", () => {
        const dequeue = new Dequeue<number>();
        dequeue.pushBack(1);
        dequeue.pushBack(2);

        dequeue.clear();

        expect(dequeue.size()).toBe(0);
        expect(dequeue.isEmpty()).toBe(true);
    });
});
