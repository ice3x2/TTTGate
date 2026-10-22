import net from "node:net";
import {FREE_PORT_MAX, FREE_PORT_MIN, getFreePort} from "../../helpers/network";

// #197: 임시 포트 범위(Linux 32768–60999, Windows 49152–65535)의 번호를 미리 받아 두면, 서버를 열기 전에
// 다른 연결의 출발 포트로 쓰여 EADDRINUSE 가 난다. getFreePort 는 그 아래 범위에서 겹치지 않게 고른다.
describe("getFreePort", () => {
    const listen = (port: number) => new Promise<net.Server>((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen({port, host: "::"}, () => resolve(server));
    });
    const close = (server: net.Server) => new Promise<void>((resolve) => server.close(() => resolve()));

    test("picks ports below both OS ephemeral ranges and never repeats one in a file", async () => {
        const ports: number[] = [];
        for(let i = 0; i < 40; i++) ports.push(await getFreePort());
        for(const port of ports) {
            expect(port).toBeGreaterThanOrEqual(FREE_PORT_MIN);
            expect(port).toBeLessThan(FREE_PORT_MAX);
        }
        expect(FREE_PORT_MAX).toBeLessThanOrEqual(32768);
        expect(new Set(ports).size).toBe(ports.length);
    });

    test("returns a port the server can open on :: like the product listeners do", async () => {
        const server = await listen(await getFreePort());
        await close(server);
    });

    test("skips a port that is already in use", async () => {
        // getFreePort 를 거치지 않고 범위 끝에서 직접 점유한다(이미 내준 번호 검사와 섞이지 않게).
        let busy = FREE_PORT_MAX - 1, holder: net.Server | undefined;
        for(; busy >= FREE_PORT_MIN && !holder; busy--) holder = await listen(busy).catch(() => undefined);
        busy++;
        if(!holder) throw new Error("no port to occupy in the free-port range");
        const random = jest.spyOn(Math, "random");
        try {
            // 첫 후보로 사용 중인 포트를 고르게 한 뒤 다음 후보는 다른 번호가 되게 한다.
            random.mockReturnValueOnce((busy - FREE_PORT_MIN) / (FREE_PORT_MAX - FREE_PORT_MIN));
            const next = await getFreePort();
            expect(next).not.toBe(busy);
            expect(next).toBeGreaterThanOrEqual(FREE_PORT_MIN);
            expect(next).toBeLessThan(FREE_PORT_MAX);
        } finally {
            random.mockRestore();
            await close(holder!);
        }
    });
});
