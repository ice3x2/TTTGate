"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PubSub = void 0;
class PubSub {
    static _instance = null;
    _topicMap = new Map();
    _tickPublish = true;
    static get instance() {
        if (!PubSub._instance) {
            PubSub._instance = new PubSub();
        }
        return PubSub._instance;
    }
    constructor() { }
    setTickPublish(tickPublish) {
        this._tickPublish = tickPublish;
    }
    static create() {
        return new PubSub();
    }
    clear() {
    }
    publish(topic, message) {
        let observers = this._topicMap.get(topic);
        if (observers) {
            for (let observer of observers) {
                if (this._tickPublish) {
                    setTimeout(() => {
                        observer(topic, message);
                    }, 0);
                }
                else {
                    observer(topic, message);
                }
            }
        }
    }
    subscribe(topic, observer) {
        let observers = this._topicMap.get(topic);
        if (!observers) {
            observers = new Array();
            this._topicMap.set(topic, observers);
        }
        observers.push(observer);
    }
    unsubscribe(topic, observer) {
        let observers = this._topicMap.get(topic);
        if (observers) {
            let index = observers.indexOf(observer);
            if (index > -1) {
                observers.splice(index, 1);
            }
        }
    }
    hasObserver(topic, observer) {
        let observers = this._topicMap.get(topic);
        if (observers) {
            return observers.indexOf(observer) > -1;
        }
        return false;
    }
    hasTopic(topic) {
        return this._topicMap.has(topic);
    }
    unsubscribeAll(topic) {
        this._topicMap.delete(topic);
    }
}
exports.PubSub = PubSub;
