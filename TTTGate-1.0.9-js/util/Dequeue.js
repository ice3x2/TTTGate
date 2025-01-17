"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Dequeue {
    _queue = new Array();
    pushBack(item) {
        this._queue.push(item);
    }
    pushFront(item) {
        this._queue.unshift(item);
    }
    remove(filter) {
        let removed = new Array();
        for (let i = 0; i < this._queue.length; i++) {
            if (filter(this._queue[i])) {
                removed.push(this._queue[i]);
                this._queue.splice(i, 1);
                i--;
            }
        }
        return removed;
    }
    front() {
        return this._queue[0];
    }
    back() {
        return this._queue[this._queue.length - 1];
    }
    popFront() {
        return this._queue.shift();
    }
    popBack() {
        return this._queue.pop();
    }
    size() {
        return this._queue.length;
    }
    isEmpty() {
        return this._queue.length == 0;
    }
    clear() {
        this._queue = new Array();
    }
}
exports.default = Dequeue;
