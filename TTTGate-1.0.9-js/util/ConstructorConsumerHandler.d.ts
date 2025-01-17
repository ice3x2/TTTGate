interface Consumer<T> {
    (item: T): boolean;
}
interface OnPause {
    (): void;
}
interface Filter<T> {
    (item: T): boolean;
}
declare class ConstructorConsumerHandler<T> {
    private readonly _queue;
    private readonly _consumer;
    private _isRunning;
    private _onPause;
    private _stackCutterCount;
    constructor(consumer: Consumer<T>);
    setStackCutterCount(count: number): ConstructorConsumerHandler<T>;
    setOnPause(onPause: OnPause): void;
    pushOnly(item: T): void;
    pushFront(item: T): void;
    removeItem(filter: Filter<T>): Array<T>;
    push(item: T): void;
    tryStart(): boolean;
    private consume;
}
export default ConstructorConsumerHandler;
