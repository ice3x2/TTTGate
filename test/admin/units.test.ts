import {byteToUnit, timeToDMH} from "../../admin/src/screens/parts/units";

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
