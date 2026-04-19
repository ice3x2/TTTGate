type ClockRng = {
    now(): number;
    random(): number;
}

const DefaultClockRng: ClockRng = {
    now(): number {
        return Date.now();
    },
    random(): number {
        return Math.random();
    }
};

let activeClockRng: ClockRng = DefaultClockRng;

const ClockRngProvider = {
    current(): ClockRng {
        return activeClockRng;
    },
    configure(clockRng: ClockRng): void {
        activeClockRng = clockRng;
    },
    reset(): void {
        activeClockRng = DefaultClockRng;
    }
};

export { ClockRng, ClockRngProvider, DefaultClockRng };
