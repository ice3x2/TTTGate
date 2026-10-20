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

/** 한 테스트 파일 안에서 같은 번호를 두 번 내주지 않는다. */
const getFreePort = async (): Promise<number> => {
    for(let attempt = 0; attempt < 200; attempt++) {
        const port = FREE_PORT_MIN + Math.floor(Math.random() * (FREE_PORT_MAX - FREE_PORT_MIN));
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

export { EchoServer, FREE_PORT_MAX, FREE_PORT_MIN, getFreePort, sendTcpAndReceive, sendTcpAndReceiveOnce, sleep, startEchoServer, waitFor };
