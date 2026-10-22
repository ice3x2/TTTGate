import TTTServer from "../../../src/server/TTTServer";

// #177 — 호출하는 곳이 없던 재시작 경로는 stop() 뒤의 상태를 읽어 만료된 터널을 잠깐 켰다. 되살아나지 않게 지운다.
describe("TTTServer dead restart path (#177)", () => {
    it("no longer exposes updateAndRestartExternalPortServer", () => {
        expect((TTTServer.prototype as unknown as Record<string, unknown>).updateAndRestartExternalPortServer).toBeUndefined();
    });
});
