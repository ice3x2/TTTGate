import net from "net";
import UsablePortChecker from "../../../src/util/UsablePortChecker";

jest.setTimeout(30_000);

// UsablePortChecker.check() 는 호스트를 지정하지 않고 listen(port) 로 바인딩한다(모든 인터페이스).
// 점유 상태를 재현하는 서버도 같은 방식(호스트 미지정)으로 바인딩해야 한다 — Windows 는 기본적으로
// 특정 인터페이스(예: 127.0.0.1)에 바인딩된 소켓이 있어도 모든 인터페이스 바인딩이 성공하는
// 경우가 있어(SO_EXCLUSIVEADDRUSE 미설정 시의 플랫폼 동작 차이), 점유 서버를 127.0.0.1 에만
// 바인딩하면 이 플랫폼에서 충돌이 재현되지 않는다. 포트 번호 자체는 listen(0, '127.0.0.1') 로
// 자동 할당받아 고정 포트 충돌을 피한다.
const getFreePort = (): Promise<number> => {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const address = probe.address();
            const port = typeof address == "object" && address ? address.port : 0;
            probe.close((err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(port);
            });
        });
    });
};

const occupyPort = (port: number): Promise<net.Server> => {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(port, () => resolve(server));
    });
};

const closeServer = (server: net.Server): Promise<void> => {
    return new Promise((resolve, reject) => {
        server.close((err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
};

describe("UsablePortChecker", () => {
    it("rejects out-of-range ports before touching the network", async () => {
        await expect(UsablePortChecker.check(0)).rejects.toThrow("port is invalid (0 ~ 65535)");
        await expect(UsablePortChecker.check(-1)).rejects.toThrow("port is invalid (0 ~ 65535)");
        await expect(UsablePortChecker.check(65536)).rejects.toThrow("port is invalid (0 ~ 65535)");
    });

    it("reports an occupied port as unusable across every query method", async () => {
        const port = await getFreePort();
        const server = await occupyPort(port);
        try {
            expect(await UsablePortChecker.check(port)).toBe(false);
            expect(await UsablePortChecker.checkPorts([port])).toEqual([]);
            expect(await UsablePortChecker.findUsablePort(port, port)).toBe(-1);
            expect(await UsablePortChecker.findUsablePorts(port, port)).toEqual([]);
            expect(await UsablePortChecker.findUsedPorts(port, port)).toEqual([port]);
        } finally {
            await closeServer(server);
        }
    });

    it("reports a freed port as usable across every query method", async () => {
        const port = await getFreePort();

        expect(await UsablePortChecker.check(port)).toBe(true);
        expect(await UsablePortChecker.checkPorts([port])).toEqual([port]);
        expect(await UsablePortChecker.findUsablePort(port, port)).toBe(port);
        expect(await UsablePortChecker.findUsablePorts(port, port, 1)).toEqual([port]);
        expect(await UsablePortChecker.findUsedPorts(port, port)).toEqual([]);
    });

    it("findUsablePorts stops once it collects the requested count", async () => {
        const port = await getFreePort();

        const found = await UsablePortChecker.findUsablePorts(port, port + 1, 1);
        expect(found).toHaveLength(1);
    });
});
