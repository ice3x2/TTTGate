interface Filter<T> {
    (item: T): boolean;
}
declare class Dequeue<T> {
    private _queue;
    pushBack(item: T): void;
    pushFront(item: T): void;
    remove(filter: Filter<T>): Array<T>;
    front(): T | undefined;
    back(): T | undefined;
    popFront(): T | undefined;
    popBack(): T | undefined;
    size(): number;
    isEmpty(): boolean;
    clear(): void;
}
export default Dequeue;
