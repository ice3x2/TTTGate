import Dequeue from "./Dequeue";

interface Consumer<T> {
    (item: T) : boolean;
}

interface OnPause {
    () : void;
}

interface Filter<T> {
    (item: T) : boolean;
}


class ConstructorConsumerHandler<T> {
    private readonly _queue : Dequeue<T> = new Dequeue<T>();
    private readonly _consumer : Consumer<T>;
    private _isRunning : boolean = false;
    private _onPause : OnPause | null = null;
    private _stackCutterCount : number = 100000;



    constructor(consumer: Consumer<T>) {
        this._consumer = consumer;
    }

    public setStackCutterCount(count: number) : ConstructorConsumerHandler<T> {
        this._stackCutterCount = count;
        return this;
    }

    public setOnPause(onPause: OnPause) : void {
        this._onPause = onPause;
    }

    public pushOnly(item: T) : void {
        this._queue.pushBack(item);
    }

    public pushFront(item: T) : void {
        this._queue.pushFront(item);
        this.tryStart();
    }

    public removeItem(filter: Filter<T>) : Array<T> {
        return this._queue.remove(filter);
    }

    public push(item: T) : void {
        this._queue.pushBack(item);
        this.tryStart();
    }

    public tryStart() : boolean {
        if(this._isRunning) {
            return false;
        }
        this._isRunning = true;
        process.nextTick(() => this.consume(0));
        return true;
    }

    private consume(callCount: number) : void {
        if(this._queue.isEmpty()) {
            this._isRunning = false;
            this._onPause?.();
            return;
        }
        let item = this._queue.popFront();
        if(item == undefined) {
            this._isRunning = false;
            this._onPause?.();
            return;
        }
        if(!this._consumer(item)) {
            this._isRunning = false;
            this._onPause?.();
            this._queue.pushFront(item);
            return;
        }
        if(callCount >= this._stackCutterCount) {
            //setImmediate(() => this.consume(0));
            process.nextTick(() => this.consume(0));
        } else {
            this.consume(++callCount);
        }

    }








}


export default ConstructorConsumerHandler;