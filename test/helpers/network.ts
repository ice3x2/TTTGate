import net from "net";

type EchoServer = {
    port: number;
    close(): Promise<void>;
    setFiniteResponseLength(length: number): void;
}

const sleep = async (ms: number): Promise<void> => {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
};

// 테스트 서버의 포트는 OS 임시 포트 범위(Linux 32768–60999, Windows 49152–65535) 아래에서 고른다. 그 범위의 번호를
// 미리 받아 두면 서버를 열기 전에 다른 연결의 출발 포트로 쓰여 EADDRINUSE 가 난다(#197). 테스트가 값으로 쓰는
// 23456·25000·30000–30010 은 이 범위 밖이다.
const FREE_PORT_MIN = 26000;
const FREE_PORT_MAX = 28600;
const handedOutPorts = new Set<number>();
// 조각이 너무 작으면 한 파일이 받는 포트가 모자라 OS 임시 포트로 넘어간다(#197). 조각은 65개 이상이 되게 한다.
const MAX_PORT_SLICES = 40;

/**
 * 이 워커가 쓸 포트 범위(#262). handedOutPorts 는 워커 프로세스마다 따로 있어 워커끼리 같은 번호를 줄 수 있다.
 * 그래서 범위를 워커 수(전역 setup 이 TTTGATE_JEST_WORKERS 로 넘긴다)만큼 나눠 워커 번호의 조각만 쓴다.
 * 워커가 하나이거나 수·번호를 모르면 전체 범위를 쓴다. 번호가 조각 수보다 크면 앞 조각으로 돌아간다.
 * 조각은 MAX_PORT_SLICES 개까지다. 워커가 그보다 많으면 두 워커가 한 조각을 나눠 쓴다(canListen 이 그나마 거른다).
 * runShift(TTTGATE_JEST_PORT_SHIFT)는 실행마다 조각 순서를 민다. 동시에 도는 다른 jest 실행과 덜 겹친다.
 */
const freePortRange = (workerId: string | undefined, workerCount: string | undefined, runShift?: string): {min: number, max: number} => {
    const id = Number(workerId), count = Number(workerCount), shift = Number(runShift);
    if(!Number.isInteger(id) || id < 1 || !Number.isInteger(count) || count <= 1) return {min: FREE_PORT_MIN, max: FREE_PORT_MAX};
    const slices = Math.min(count, MAX_PORT_SLICES);
    const size = Math.floor((FREE_PORT_MAX - FREE_PORT_MIN) / slices);
    const slice = (id - 1 + (Number.isInteger(shift) && shift >= 0 ? shift : 0)) % slices;
    const min = FREE_PORT_MIN + slice * size;
    return {min, max: min + size};
};

/** 제품 리스너처럼 :: (듀얼 스택)에 열어 볼 수 있으면 true. 사용 중이거나 예약된 포트는 false. */
const canListen = (port: number): Promise<boolean> => new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({port, host: "::"}, () => server.close(() => resolve(true)));
});

/** OS 가 고른 임시 포트. 범위 안에서 찾지 못했을 때만 쓴다. */
const getEphemeralPort = async (): Promise<number> => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port = typeof address == "object" && address ? address.port : 0;
    await new Promise<void>((resolve, reject) => {
        server.close((err) => {
            if(err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
    return port;
};

/** 한 테스트 파일 안에서 같은 번호를 두 번 내주지 않고, 다른 워커와 같은 번호도 주지 않는다(#262). */
const getFreePort = async (): Promise<number> => {
    const {min, max} = freePortRange(process.env.JEST_WORKER_ID, process.env.TTTGATE_JEST_WORKERS, process.env.TTTGATE_JEST_PORT_SHIFT);
    const size = max - min;
    // 무작위 위치에서 시작해 조각 전체를 한 바퀴 돈다. 조각이 작아도 남은 번호를 놓치지 않는다.
    const start = Math.floor(Math.random() * size);
    for(let step = 0; step < size; step++) {
        const port = min + (start + step) % size;
        if(handedOutPorts.has(port) || !await canListen(port)) continue;
        handedOutPorts.add(port);
        return port;
    }
    const port = await getEphemeralPort();
    handedOutPorts.add(port);
    return port;
};

const startEchoServer = async (): Promise<EchoServer> => {
    let finiteLength: number | undefined;
    const server = net.createServer((socket) => {
        const expected = finiteLength, parts: Buffer[] = [];
        let received = 0, replied = false;
        socket.on("data", (chunk) => {
            if(expected === undefined) { socket.write(chunk); return; }
            if(replied) return;
            parts.push(chunk); received += chunk.length;
            if(received >= expected) { replied = true; socket.end(Buffer.concat(parts)); }
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    const port = typeof address == "object" && address ? address.port : 0;

    return {
        port,
        setFiniteResponseLength(length: number) { finiteLength = length; },
        async close(): Promise<void> {
            await new Promise<void>((resolve, reject) => {
                server.close((err) => {
                    if(err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        }
    };
};

const sendTcpAndReceiveOnce = ({host, port, payload, timeoutMs}: {
    host: string; port: number; payload: Buffer | string; timeoutMs: number
}): Promise<Buffer> => new Promise((resolve, reject) => {
    const socket = net.createConnection({host, port}), chunks: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error) => {
        if(settled) return;
        settled = true; clearTimeout(timer); socket.destroy();
        if(error) reject(error); else resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => finish(new Error('One-shot TCP exchange deadline exceeded')), timeoutMs);
    socket.once('connect', () => socket.write(payload));
    socket.on('data', data => chunks.push(Buffer.from(data)));
    socket.once('end', () => finish());
    socket.once('error', error => finish(error));
    socket.once('close', () => { if(!settled) finish(new Error('TCP connection closed before peer FIN')); });
});

const sendTcpAndReceive = async (port: number, payload: Buffer | string, host: string = "127.0.0.1"): Promise<Buffer> => {
    const expected = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);

    return new Promise<Buffer>((resolve, reject) => {
        const socket = net.createConnection({host, port});
        const chunks: Buffer[] = [];
        let settled = false;

        const finish = (callback: () => void) => {
            if(settled) {
                return;
            }
            settled = true;
            callback();
        };

        socket.once("connect", () => {
            socket.write(expected);
        });

        socket.on("data", (chunk) => {
            chunks.push(chunk);
            const received = Buffer.concat(chunks);
            if(received.length >= expected.length) {
                socket.end();
                finish(() => resolve(received.subarray(0, expected.length)));
            }
        });

        socket.once("error", (err) => {
            finish(() => reject(err));
        });

        socket.once("close", () => {
            if(settled) {
                return;
            }
            const received = Buffer.concat(chunks);
            finish(() => reject(new Error(`Socket closed before ${expected.length} bytes were echoed. received=${received.length}`)));
        });
    });
};

const waitFor = async <T>(callback: () => Promise<T> | T, {timeoutMs = 10000, intervalMs = 100}: {timeoutMs?: number, intervalMs?: number} = {}): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while(Date.now() < deadline) {
        try {
            return await callback();
        } catch (error) {
            lastError = error;
            await sleep(intervalMs);
        }
    }

    if(lastError instanceof Error) {
        throw lastError;
    }

    throw new Error(`Timed out after ${timeoutMs}ms`);
};

export { EchoServer, FREE_PORT_MAX, FREE_PORT_MIN, freePortRange, getFreePort, sendTcpAndReceive, sendTcpAndReceiveOnce, sleep, startEchoServer, waitFor };
