declare class Optional<T> {
    private static readonly EMPTY;
    private readonly value;
    private constructor();
    static empty<T>(): Optional<T>;
    static of<T>(value: T): Optional<T>;
    static ofNullable<T>(value: T | null): Optional<T>;
    get(): T;
    isPresent(): boolean;
    isEmpty(): boolean;
    ifPresent(action: (value: T) => void): void;
    ifPresentOrElse(action: (value: T) => void, emptyAction: () => void): void;
    filter(predicate: (value: T) => boolean): Optional<T>;
    map<U>(mapper: (value: T) => U): Optional<U>;
    flatMap<U>(mapper: (value: T) => Optional<U>): Optional<U>;
    or(supplier: () => Optional<T>): Optional<T>;
    orElse(other: T): T;
    orElseGet(supplier: () => T): T;
    orElseThrow<X extends Error>(exceptionSupplier: () => X): T;
    equals(obj: any): boolean;
    toString(): string;
}
export default Optional;
