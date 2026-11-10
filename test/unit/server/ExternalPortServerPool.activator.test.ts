import {ExternalPortServerPool, ExternalPortServerStatus} from "../../../src/server/ExternalPortServerPool";

// 이슈 347 — 켠 사람(activatedBy)은 활성 상태에만 속한다. 끄면 지운다.
describe("ExternalPortServerPool 켠 사람", () => {
    const PORT = 20001;
    let pool: ExternalPortServerPool;

    beforeEach(() => {
        pool = ExternalPortServerPool.create([]);
        // 리스너 없이 상태만 둔다. active·inactive 는 상태와 타이머만 다룬다.
        const status: ExternalPortServerStatus = {port: PORT, online: true, sessions: 0, uptime: 0, active: false, activeStart: 0, activeTimeout: 0,
            rx: 0, tx: 0, rejected: {geo: 0, rateLimit: 0}, bannedIps: 0};
        (pool as unknown as {_statusMap: Map<number, ExternalPortServerStatus>})._statusMap.set(PORT, status);
    });

    afterEach(async () => {
        await pool.stopAll();
    });

    it("켤 때 켠 사람을 두고, 끄면 지운다", async () => {
        expect(await pool.active(PORT, 0, {activatedBy: "u_alice"})).toBe(true);
        expect(pool.getServerStatus(PORT).activatedBy).toBe("u_alice");
        expect(await pool.inactive(PORT)).toBe(true);
        expect(pool.getServerStatus(PORT).activatedBy).toBeUndefined();
    });
});
