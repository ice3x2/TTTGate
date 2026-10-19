import Optional from "../../../src/util/Optional";

describe("Optional", () => {
    it("empty() returns the same shared instance and reports absence", () => {
        expect(Optional.empty().isPresent()).toBe(false);
        expect(Optional.empty().isEmpty()).toBe(true);
        expect(() => Optional.empty().get()).toThrow("No value present");
        expect(Optional.empty()).toBe(Optional.empty());
    });

    it("of(value) wraps a present value", () => {
        const optional = Optional.of(3);
        expect(optional.get()).toBe(3);
        expect(optional.isPresent()).toBe(true);
    });

    it("ofNullable treats only null as empty, not undefined", () => {
        const fromNull = Optional.ofNullable(null);
        expect(fromNull.isEmpty()).toBe(true);
        expect(fromNull).toBe(Optional.empty());

        const fromUndefined = Optional.ofNullable(undefined);
        expect(fromUndefined.isPresent()).toBe(true);
    });

    it("ifPresent invokes the action only when a value exists", () => {
        const action = jest.fn();
        Optional.of(5).ifPresent(action);
        expect(action).toHaveBeenCalledWith(5);

        action.mockClear();
        Optional.empty().ifPresent(action);
        expect(action).not.toHaveBeenCalled();
    });

    it("ifPresentOrElse invokes only the empty-branch callback when empty", () => {
        const action = jest.fn();
        const emptyAction = jest.fn();

        Optional.empty().ifPresentOrElse(action, emptyAction);
        expect(action).not.toHaveBeenCalled();
        expect(emptyAction).toHaveBeenCalledTimes(1);
    });

    it("filter keeps the same object when the predicate matches and empties otherwise", () => {
        const three = Optional.of(3);
        expect(three.filter((v) => v > 5).isEmpty()).toBe(true);

        const nine = Optional.of(9);
        expect(nine.filter((v) => v > 5)).toBe(nine);

        expect(Optional.empty<number>().filter((v) => v > 5)).toBe(Optional.empty());
    });

    it("map transforms the value and empties when the mapper returns null", () => {
        expect(Optional.of(2).map((v) => v * 2).get()).toBe(4);
        expect(Optional.of(2).map(() => null).isEmpty()).toBe(true);

        const mapper = jest.fn();
        Optional.empty().map(mapper);
        expect(mapper).not.toHaveBeenCalled();
    });

    it("flatMap unwraps the returned Optional and empties on a null result", () => {
        expect(Optional.of(2).flatMap((v) => Optional.of(v + 1)).get()).toBe(3);
        expect(Optional.of(2).flatMap(() => null as any).isEmpty()).toBe(true);

        const mapper = jest.fn();
        Optional.empty().flatMap(mapper);
        expect(mapper).not.toHaveBeenCalled();
    });

    it("or returns itself when present without invoking the supplier, otherwise defers to it", () => {
        const supplier = jest.fn(() => Optional.of(2));
        expect(Optional.of(1).or(supplier).get()).toBe(1);
        expect(supplier).not.toHaveBeenCalled();

        expect(Optional.empty<number>().or(() => Optional.of(2)).get()).toBe(2);
        expect(Optional.empty<number>().or(() => null as any).isEmpty()).toBe(true);
    });

    it("orElse, orElseGet, and orElseThrow fall back only when empty", () => {
        expect(Optional.empty<number>().orElse(7)).toBe(7);
        expect(Optional.of(1).orElse(7)).toBe(1);
        expect(Optional.empty<number>().orElseGet(() => 8)).toBe(8);

        expect(() => Optional.empty().orElseThrow(() => new RangeError("x"))).toThrow(RangeError);

        const exceptionSupplier = jest.fn(() => new RangeError("x"));
        expect(Optional.of(1).orElseThrow(exceptionSupplier)).toBe(1);
        expect(exceptionSupplier).not.toHaveBeenCalled();
    });

    it("equals compares by wrapped value, not by reference", () => {
        expect(Optional.of(1).equals(Optional.of(1))).toBe(true);
        expect(Optional.of(1).equals(Optional.of(2))).toBe(false);
        expect(Optional.of(1).equals(1)).toBe(false);
        expect(Optional.empty().equals(Optional.empty())).toBe(true);
    });

    it("toString formats present and empty values differently", () => {
        expect(Optional.of("a").toString()).toBe("Optional[a]");
        expect(Optional.empty().toString()).toBe("Optional.empty");
    });
});
