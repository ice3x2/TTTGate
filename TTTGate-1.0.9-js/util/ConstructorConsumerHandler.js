"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Dequeue_1 = __importDefault(require("./Dequeue"));
class ConstructorConsumerHandler {
    _queue = new Dequeue_1.default();
    _consumer;
    _isRunning = false;
    _onPause = null;
    _stackCutterCount = 100000;
    constructor(consumer) {
        this._consumer = consumer;
    }
    setStackCutterCount(count) {
        this._stackCutterCount = count;
        return this;
    }
    setOnPause(onPause) {
        this._onPause = onPause;
    }
    pushOnly(item) {
        this._queue.pushBack(item);
    }
    pushFront(item) {
        this._queue.pushFront(item);
        this.tryStart();
    }
    removeItem(filter) {
        return this._queue.remove(filter);
    }
    push(item) {
        this._queue.pushBack(item);
        this.tryStart();
    }
    tryStart() {
        if (this._isRunning) {
            return false;
        }
        this._isRunning = true;
        process.nextTick(() => this.consume(0));
        return true;
    }
    consume(callCount) {
        if (this._queue.isEmpty()) {
            this._isRunning = false;
            this._onPause?.();
            return;
        }
        let item = this._queue.popFront();
        if (item == undefined) {
            this._isRunning = false;
            this._onPause?.();
            return;
        }
        if (!this._consumer(item)) {
            this._isRunning = false;
            this._onPause?.();
            this._queue.pushFront(item);
            return;
        }
        if (callCount >= this._stackCutterCount) {
            //setImmediate(() => this.consume(0));
            process.nextTick(() => this.consume(0));
        }
        else {
            this.consume(++callCount);
        }
    }
}
exports.default = ConstructorConsumerHandler;
