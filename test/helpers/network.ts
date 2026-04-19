import net from "net";

type EchoServer = {
    port: number;
    close(): Promise<void>;
}

const sleep = async (ms: number): Promise<void> => {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
};

const getFreePort = async (): Promise<number> => {
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

const startEchoServer = async (): Promise<EchoServer> => {
    const server = net.createServer((socket) => {
        socket.on("data", (chunk) => {
            socket.write(chunk);
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

export { EchoServer, getFreePort, sendTcpAndReceive, sleep, startEchoServer, waitFor };
