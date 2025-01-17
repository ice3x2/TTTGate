"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Optional {
    static EMPTY = new Optional(null);
    value;
    constructor(value) {
        this.value = value;
    }
    static empty() {
        return this.EMPTY;
    }
    static of(value) {
        return new Optional(value);
    }
    static ofNullable(value) {
        return value === null ? this.empty() : this.of(value);
    }
    get() {
        if (this.value === null) {
            throw new Error('No value present');
        }
        return this.value;
    }
    isPresent() {
        return this.value !== null;
    }
    isEmpty() {
        return this.value === null;
    }
    ifPresent(action) {
        if (this.value !== null) {
            action(this.value);
        }
    }
    ifPresentOrElse(action, emptyAction) {
        if (this.value !== null) {
            action(this.value);
        }
        else {
            emptyAction();
        }
    }
    filter(predicate) {
        if (!this.isPresent()) {
            return this;
        }
        else {
            return predicate(this.value) ? this : Optional.empty();
        }
    }
    map(mapper) {
        if (!this.isPresent()) {
            return Optional.empty();
        }
        else {
            return Optional.ofNullable(mapper(this.value));
        }
    }
    flatMap(mapper) {
        if (!this.isPresent()) {
            return Optional.empty();
        }
        else {
            const result = mapper(this.value);
            return result !== null ? result : Optional.empty();
        }
    }
    or(supplier) {
        if (this.isPresent()) {
            return this;
        }
        else {
            const result = supplier();
            return result !== null ? result : Optional.empty();
        }
    }
    orElse(other) {
        return this.value !== null ? this.value : other;
    }
    orElseGet(supplier) {
        return this.value !== null ? this.value : supplier();
    }
    orElseThrow(exceptionSupplier) {
        if (this.value !== null) {
            return this.value;
        }
        else {
            throw exceptionSupplier();
        }
    }
    equals(obj) {
        if (this === obj) {
            return true;
        }
        if (!(obj instanceof Optional)) {
            return false;
        }
        const other = obj;
        return this.value === other.value;
    }
    toString() {
        return this.value !== null ? `Optional[${this.value}]` : 'Optional.empty';
    }
}
exports.default = Optional;
