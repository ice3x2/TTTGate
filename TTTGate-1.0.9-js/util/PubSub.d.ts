interface Observer {
    (topic: string, message: any): void;
}
declare class PubSub {
    private static _instance;
    private _topicMap;
    private _tickPublish;
    static get instance(): PubSub;
    private constructor();
    setTickPublish(tickPublish: boolean): void;
    static create(): PubSub;
    clear(): void;
    publish(topic: string, message: any): void;
    subscribe(topic: string, observer: Observer): void;
    unsubscribe(topic: string, observer: Observer): void;
    hasObserver(topic: string, observer: Observer): boolean;
    hasTopic(topic: string): boolean;
    unsubscribeAll(topic: string): void;
}
export { PubSub, Observer };
