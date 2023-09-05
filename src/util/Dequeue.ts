

interface Filter<T> {
    (item: T) : boolean;
}

class Dequeue<T> {

    private _queue : Array<T> = new Array<T>();

    public pushBack(item: T) : void {
        this._queue.push(item);
    }

    public pushFront(item: T) : void {
        this._queue.unshift(item);
    }

    public remove(filter : Filter<T>) : Array<T> {
        let removed = new Array<T>();
        for(let i = 0; i < this._queue.length; i++) {
            if(filter(this._queue[i])) {
                removed.push(this._queue[i]);
                this._queue.splice(i, 1);
                i--;
            }
        }
        return removed;

    }


    public front() : T | undefined {
        return this._queue[0];
    }

    public back() : T | undefined {
        return this._queue[this._queue.length - 1];
    }

    public popFront() : T | undefined {
        return this._queue.shift();
    }

    public popBack() : T | undefined {
        return this._queue.pop();
    }


    public size() : number {
        return this._queue.length;
    }

    public isEmpty() : boolean {
        return this._queue.length == 0;
    }

    public clear() : void {
        this._queue = new Array<T>();
    }

}

export default Dequeue;