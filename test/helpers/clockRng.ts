import {ClockRng} from "../../src/util/ClockRng";

type FakeClockRng = ClockRng & {
    advance(ms: number): void;
    setRandomValues(values: number[]): void;
}

const createFakeClockRng = (initialNow: number = 1_700_000_000_000, initialRandomValues: number[] = [0.5]): FakeClockRng => {
    let now = initialNow;
    let randomValues = initialRandomValues.length > 0 ? [...initialRandomValues] : [0.5];

    return {
        now(): number {
            return now;
        },
        random(): number {
            if(randomValues.length > 1) {
                return randomValues.shift()!;
            }
            return randomValues[0] ?? 0.5;
        },
        advance(ms: number): void {
            now += ms;
        },
        setRandomValues(values: number[]): void {
            randomValues = values.length > 0 ? [...values] : [0.5];
        }
    };
};

export { createFakeClockRng, FakeClockRng };
