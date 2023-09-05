
class Optional<T> {

    private static readonly EMPTY = new Optional<any>(null);
    private readonly value: T | null;

    private constructor(value: T | null) {
        this.value = value;
    }

    public static empty<T>(): Optional<T> {
        return this.EMPTY as Optional<T>;
    }

    public static of<T>(value: T): Optional<T> {
        return new Optional<T>(value);
    }

    public static ofNullable<T>(value: T | null): Optional<T> {
        return value === null ? this.empty<T>() : this.of(value);
    }

    public get(): T {
        if (this.value === null) {
            throw new Error('No value present');
        }
        return this.value;
    }

    public isPresent(): boolean {
        return this.value !== null;
    }

    public isEmpty(): boolean {
        return this.value === null;
    }

    public ifPresent(action: (value: T) => void): void {
        if (this.value !== null) {
            action(this.value);
        }
    }

    public ifPresentOrElse(action: (value: T) => void, emptyAction: () => void): void {
        if (this.value !== null) {
            action(this.value);
        } else {
            emptyAction();
        }
    }

    public filter(predicate: (value: T) => boolean): Optional<T> {
        if (!this.isPresent()) {
            return this;
        } else {
            return predicate(this.value!) ? this : Optional.empty<T>();
        }
    }

    public  map<U>(mapper: (value: T) => U): Optional<U> {
        if (!this.isPresent()) {
            return Optional.empty<U>();
        } else {
            return Optional.ofNullable(mapper(this.value!));
        }
    }

    public  flatMap<U>(mapper: (value: T) => Optional<U>): Optional<U> {
        if (!this.isPresent()) {
            return Optional.empty<U>();
        } else {
            const result = mapper(this.value!);
            return result !== null ? result : Optional.empty<U>();
        }
    }

    public or(supplier: () => Optional<T>): Optional<T> {
        if (this.isPresent()) {
            return this;
        } else {
            const result = supplier();
            return result !== null ? result : Optional.empty<T>();
        }
    }

    public orElse(other: T): T {
        return this.value !== null ? this.value : other;
    }

    public orElseGet(supplier: () => T): T {
        return this.value !== null ? this.value : supplier();
    }

    public orElseThrow<X extends Error>(exceptionSupplier: () => X): T {
        if (this.value !== null) {
            return this.value;
        } else {
            throw exceptionSupplier();
        }
    }

    public equals(obj: any): boolean {
        if (this === obj) {
            return true;
        }

        if (!(obj instanceof Optional)) {
            return false;
        }

        const other = obj as Optional<any>;
        return this.value === other.value;
    }

    public toString(): string {
        return this.value !== null ? `Optional[${this.value}]` : 'Optional.empty';
    }
}

export default Optional;