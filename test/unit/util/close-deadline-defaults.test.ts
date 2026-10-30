import {SocketHandler} from "../../../src/util/SocketHandler";
import {DEFAULT_CLOSE_GRACE_MS, DEFAULT_CLOSE_STALL_MS, ServerOption} from "../../../src/types/TunnelingOption";
import {applyStartupRuntimeOptions} from "../../../src/server/ServerApp";
import LoggerFactory from "../../../src/util/logger/LoggerFactory";

// #268 — 서버 설정의 기본값과 SocketHandler 의 시작값이 같아야 한다. 설정이 없는 서버가 지금과 같은 기한을 쓴다.
test("server option close deadline defaults match the SocketHandler start values", () => {
    expect(DEFAULT_CLOSE_STALL_MS).toBe(60_000);
    expect(DEFAULT_CLOSE_GRACE_MS).toBe(10_000);
    expect(SocketHandler.closeStallMs).toBe(DEFAULT_CLOSE_STALL_MS);
    expect(SocketHandler.closeGraceMs).toBe(DEFAULT_CLOSE_GRACE_MS);
});

// #268 REQ-1 — 시작할 때 server.yaml 의 닫기 기한을 적용한다. 값이 없으면 기본값이다(로그 레벨과 같은 함수, ServerApp 프로세스 테스트가 호출을 지킨다).
describe("applyStartupRuntimeOptions", () => {
    const previous = {stall: SocketHandler.closeStallMs, grace: SocketHandler.closeGraceMs};
    afterEach(() => {
        SocketHandler.closeStallMs = previous.stall;
        SocketHandler.closeGraceMs = previous.grace;
        LoggerFactory.setLevel(undefined);
    });

    test("applies the configured close deadlines and falls back to the defaults", () => {
        applyStartupRuntimeOptions({closeStallMs: 90_000, closeGraceMs: 4_000} as ServerOption);
        expect({stall: SocketHandler.closeStallMs, grace: SocketHandler.closeGraceMs}).toEqual({stall: 90_000, grace: 4_000});
        applyStartupRuntimeOptions({} as ServerOption);
        expect({stall: SocketHandler.closeStallMs, grace: SocketHandler.closeGraceMs}).toEqual({stall: DEFAULT_CLOSE_STALL_MS, grace: DEFAULT_CLOSE_GRACE_MS});
    });
});
