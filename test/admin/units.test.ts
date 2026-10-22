import {byteToUnit, startupTime, timeToDMH, toSize} from "../../admin/src/screens/parts/units";

// screens/parts/units.ts 는 옛 layout/ServerStatusLayout.svelte 와 layout/SysinfoPopup.svelte 에
// 두 벌로 있던 표시 단위 변환을 한 곳으로 모은 것이다. 이 테스트는 그 이동이 정확했는지 고정한다.
// 기대값은 42fdf68 시점의 원본 _byteToUnit(80~96행)·_timeToDMH(120~127행) 를 그대로 실행해 얻었다.

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;
const TIB = GIB * 1024;

describe("byteToUnit", () => {
    // 분기가 초과 비교(length > kib)이므로 정확히 1024 배수인 값은 한 단계 아래 단위에 남는다.
    // 이 경계가 뒤집히면 1024B 가 1KiB 로, 1024KiB 가 1MiB 로 바뀐다.
    const CASES: ReadonlyArray<readonly [number, string]> = [
        [0, "0B"],
        [1023, "1023B"],
        [KIB, "1024B"],
        [KIB + 1, "1KiB"],
        [1536, "1.5KiB"],
        [MIB, "1024KiB"],
        [MIB + 1, "1MiB"],
        [1310720, "1.3MiB"],
        [1300234, "1.2MiB"],
        [GIB, "1024MiB"],
        [GIB + 1, "1GiB"],
        [1610612736, "1.5GiB"],
        [8589934592, "8GiB"],
        [TIB, "1024GiB"],
        [TIB + 1, "1TiB"],
        [2199023255552, "2TiB"],
    ];

    test.each(CASES)("%i 바이트를 %s 로 적는다", (length, expected) => {
        expect(byteToUnit(length)).toBe(expected);
    });

    // hideUnit 은 수치만 남기므로, 기대값은 같은 입력의 표기에서 단위 글자만 걷어낸 것이다.
    test.each(CASES)("%i 바이트는 hideUnit 이면 %s 에서 단위를 뺀 수치만 남는다", (length, expected) => {
        expect(byteToUnit(length, true)).toBe(expected.replace(/(TiB|GiB|MiB|KiB|B)$/, ""));
    });

    test("hideUnit 을 생략하면 false 를 넘긴 것과 같다", () => {
        expect(byteToUnit(1536)).toBe(byteToUnit(1536, false));
        expect(byteToUnit(1536, false)).toBe("1.5KiB");
    });

    test("소수 둘째 자리는 반올림해 한 자리로 줄인다", () => {
        expect(byteToUnit(1310720)).toBe("1.3MiB");
        expect(byteToUnit(1300234)).toBe("1.2MiB");
    });
});

describe("timeToDMH", () => {
    test.each([
        [0, "0d 0h 0m 0s"],
        [999, "0d 0h 0m 0s"],
        [1000, "0d 0h 0m 1s"],
        [1500, "0d 0h 0m 1s"],
        [65000, "0d 0h 1m 5s"],
        [3600000, "0d 1h 0m 0s"],
        [86400000, "1d 0h 0m 0s"],
        [93784000, "1d 2h 3m 4s"],
        [259199000, "2d 23h 59m 59s"],
        [259200000, "3d 0h 0m 0s"],
    ] as ReadonlyArray<readonly [number, string]>)("%i 밀리초를 %s 로 적는다", (ms, expected) => {
        expect(timeToDMH(ms)).toBe(expected);
    });

    test("1초에 못 미치는 나머지는 버린다", () => {
        expect(timeToDMH(999)).toBe(timeToDMH(0));
        expect(timeToDMH(1999)).toBe(timeToDMH(1000));
    });
});

// startupTime·toSize 는 옛 layout/TunnelOptionSetLayout.svelte 의 _startupTime·_floorPoint·_toSize(353~387행)를 옮긴 것이다.
// 기대값은 7664c12 시점의 원본을 Date.now 를 고정한 채 그대로 실행해 얻었다.
//
// 아래 기대값은 보기에 어색해도 원본 동작을 그대로 고정한 것이다. 이유 없이 '고치지' 말 것:
//   - 엄격한 > 비교라 정확히 60초·60분·24시간이면 "60s"·"60m"·"24h, 0m" 이다.
//   - 1024 배수는 한 단계 아래 단위에 남아 "1024B"·"1024Kb"·"1024Mb" 다.
//   - 소수 둘째 자리를 내림하므로 1177.6 은 1.15Kb 가 아니라 "1.14Kb" 다.
// 유일하게 원본과 다른 것은 음수 경과의 0 하한이며, 해당 케이스에 따로 적어 두었다.

describe("startupTime", () => {
    const NOW = 1_800_000_000_000;
    const SECOND = 1000;
    const MINUTE = 60 * SECOND;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;

    // 경과 시간을 실제 시계로 기다리지 않도록 현재 시각을 고정한다.
    beforeEach(() => { jest.spyOn(Date, "now").mockReturnValue(NOW); });
    afterEach(() => { jest.restoreAllMocks(); });

    test.each([
        [0, "0s"],
        [999, "0s"],
        [SECOND, "1s"],
        [1500.5, "1s"],
        [MINUTE - 1, "59s"],
        [MINUTE, "60s"],
        [MINUTE + 1, "1m"],
        [HOUR - 1, "59m"],
        [HOUR, "60m"],
        [HOUR + 1, "1h, 0m"],
        [DAY - 1, "23h, 59m"],
        [DAY, "24h, 0m"],
        [DAY + 1, "1d, 0h"],
        [DAY + HOUR + MINUTE + SECOND, "1d, 1h"],
        [3 * DAY + 23 * HOUR + 59 * MINUTE, "3d, 23h"],
        // 원본과 의도적으로 다른 유일한 경우. 원본은 "-5s" 를 찍었다.
        // uptime 은 서버 시각이고 빼는 쪽은 클라이언트 시계라, 클라이언트 시계가 서버보다 늦으면 음수가 된다.
        [-5 * SECOND, "0s"],
        [-1, "0s"],
    ] as ReadonlyArray<readonly [number, string]>)("시작 후 %sms 가 지났으면 %s 로 적는다", (elapsed, expected) => {
        expect(startupTime(NOW - elapsed)).toBe(expected);
    });

    test.each([[0], [NaN]])("시작 시각이 %s 처럼 거짓 값이면 0s 로 적는다", (uptime) => {
        expect(startupTime(uptime)).toBe("0s");
    });
});

describe("toSize", () => {
    test.each([
        [0, "0B"],
        [-1, "-1B"],
        [0.5, "0.5B"],
        [1, "1B"],
        [1023, "1023B"],
        [KIB, "1024B"],
        [KIB + 1, "1Kb"],
        [1536, "1.5Kb"],
        [1177, "1.14Kb"],
        [1177.6, "1.14Kb"],
        [2047, "1.99Kb"],
        [MIB - 1, "1023.99Kb"],
        [MIB, "1024Kb"],
        [MIB + 1, "1Mb"],
        [1.5 * MIB, "1.5Mb"],
        [GIB - 1, "1023.99Mb"],
        [GIB, "1024Mb"],
        [GIB + 1, "1Gb"],
        [5.5 * GIB, "5.5Gb"],
        [2048 * GIB, "2048Gb"],
        [1e21, "931322574615.47Gb"],
        [NaN, "NaNB"],
    ] as ReadonlyArray<readonly [number, string]>)("%s 바이트를 %s 로 적는다", (bytes, expected) => {
        expect(toSize(bytes)).toBe(expected);
    });
});
