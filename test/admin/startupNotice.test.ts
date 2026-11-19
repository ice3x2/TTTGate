import {showsStartupOffLater} from "../../admin/src/screens/parts/startupNotice";

// 이슈 389 FR-3 — 지금 켜진 터널에서 "서버 시작 시 꺼진 채로"를 꺼짐→켜짐으로 바꿔 저장했을 때만 알린다.
const on = {online: true, active: true};

describe("showsStartupOffLater (FR-3)", () => {
    test("AC-2 켜진 터널에서 꺼짐→켜짐으로 바꾸면 알린다", () => {
        expect(showsStartupOffLater(false, true, on)).toBe(true);
    });
    test("값이 없던 옛 설정(undefined)에서 켜짐으로 바꿔도 알린다", () => {
        expect(showsStartupOffLater(undefined, true, on)).toBe(true);
    });
    test("AC-3 꺼진 터널이면 알리지 않는다", () => {
        expect(showsStartupOffLater(false, true, {online: true, active: false})).toBe(false);
    });
    test("리스너가 돌지 않던 터널(포트를 열지 못함)은 저장하면 이 설정을 따르므로 알리지 않는다", () => {
        expect(showsStartupOffLater(false, true, {online: false, active: true})).toBe(false);
    });
    test("상태를 아직 읽지 못했거나 새 터널이면 알리지 않는다", () => {
        expect(showsStartupOffLater(false, true, undefined)).toBe(false);
    });
    test("값을 바꾸지 않았거나 켜짐→꺼짐으로 바꾸면 알리지 않는다", () => {
        expect(showsStartupOffLater(true, true, on)).toBe(false);
        expect(showsStartupOffLater(false, false, on)).toBe(false);
        expect(showsStartupOffLater(true, false, on)).toBe(false);
    });
});
