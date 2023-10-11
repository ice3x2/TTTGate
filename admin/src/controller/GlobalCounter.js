class GlobalCounter {
    static _counter = 0;
    static incrementAndGet() {
        return ++GlobalCounter._counter;
    }
    static getAndIncrement() {
        return GlobalCounter._counter++;
    }
    static get counter() {
        return GlobalCounter._counter;
    }
    static set counter(value) {
        GlobalCounter._counter = value;
    }
}
export default GlobalCounter;
//# sourceMappingURL=GlobalCounter.js.map