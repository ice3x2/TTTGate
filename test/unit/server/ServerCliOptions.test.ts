import {normalizeBooleanOption, shouldResetServerState} from "../../../src/server/ServerCliOptions";

describe("ServerCliOptions", () => {
    it("treats explicit false reset flags as non-destructive", () => {
        expect(normalizeBooleanOption(undefined)).toBeUndefined();
        expect(shouldResetServerState({})).toBe(false);
        expect(shouldResetServerState({reset: "false"})).toBe(false);
        expect(shouldResetServerState({reset: "0"})).toBe(false);
    });

    it("treats bare or truthy reset flags as destructive reset requests", () => {
        expect(shouldResetServerState({reset: ""})).toBe(true);
        expect(shouldResetServerState({reset: "true"})).toBe(true);
        expect(shouldResetServerState({reset: "yes"})).toBe(true);
    });
});
