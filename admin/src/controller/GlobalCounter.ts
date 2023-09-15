

class GlobalCounter {
    private static  _counter: number = 0;

    public static incrementAndGet() : number {
        return ++GlobalCounter._counter;
    }

    public static getAndIncrement() : number {
        return GlobalCounter._counter++;
    }

    public static get counter() : number {
        return GlobalCounter._counter;
    }

    public static set counter(value : number) {
        GlobalCounter._counter = value;
    }


}

export default GlobalCounter;