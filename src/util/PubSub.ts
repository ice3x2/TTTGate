

interface Observer { (topic: string, message: any): void }

class PubSub {

    private static _instance : PubSub | null = null;
    private _topicMap : Map<string, Array<Observer>> = new Map<string, Array<Observer>>();
    private _tickPublish: boolean = true;


    public static get instance() : PubSub {
        if(!PubSub._instance) {
            PubSub._instance = new PubSub();
        }
        return PubSub._instance;
    }

    private constructor() {}

    public setTickPublish(tickPublish: boolean) {
        this._tickPublish = tickPublish;
    }

    public static create() : PubSub {
        return new PubSub();
    }

    public clear() {

    }

    public publish(topic: string, message: any) {
        let observers = this._topicMap.get(topic);
        if(observers) {
            for(let observer of observers) {
                if(this._tickPublish) {
                    setTimeout(() => {
                        observer(topic, message);
                    }, 0);
                } else {
                    observer(topic, message);
                }
            }
        }

    }

    public subscribe(topic: string, observer: Observer)  {
        let observers = this._topicMap.get(topic);
        if(!observers) {
            observers = new Array<Observer>();
            this._topicMap.set(topic, observers);
        }
        observers.push(observer);
    }

    public unsubscribe(topic: string, observer: Observer) {
        let observers = this._topicMap.get(topic);
        if(observers) {
            let index = observers.indexOf(observer);
            if(index > -1) {
                observers.splice(index, 1);
            }
        }
    }

    public hasObserver(topic: string, observer: Observer) : boolean {
        let observers = this._topicMap.get(topic);
        if(observers) {
            return observers.indexOf(observer) > -1;
        }
        return false;
    }

    public hasTopic(topic: string) : boolean {
        return this._topicMap.has(topic);
    }

    public unsubscribeAll(topic: string) {
        this._topicMap.delete(topic);
    }

}

export { PubSub, Observer };