// #245 — 거절 응답(503)을 받은 상대가 RST 로 끊어도 서버 프로세스가 살아 있어야 한다.
// 실패하면 프로세스가 죽으므로 jest 밖의 자식 프로세스로 돌린다.
import net from "node:net";
import {TCPServer} from "../../../src/util/TCPServer";
import {getFreePort} from "../../helpers/network";

const HTTP_503 = Buffer.from("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");

const main = async () => {
    const mode = process.argv[2];
    const port = await getFreePort();
    const server = TCPServer.create({port, keepAlive: 0,
        admit: () => ({allowed: false, reason: "concurrency-limit", rejectResponse: HTTP_503})});
    await new Promise<void>((resolve, reject) => server.start((err) => err ? reject(err) : resolve()));
    const attempts = mode === "reset-immediate" ? 100 : 30;
    for(let i = 0; i < attempts; i++) {
        await new Promise<void>((resolve) => {
            const socket = net.connect(port, "127.0.0.1");
            socket.on("error", () => {});
            if(mode === "reset-immediate") socket.once("connect", () => { socket.resetAndDestroy(); resolve(); });
            else socket.once("data", () => { socket.resetAndDestroy(); resolve(); });
            socket.once("close", () => resolve());
        });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    await new Promise<void>((resolve) => server.stop(() => resolve()));
    console.log("SURVIVED");
};

main().catch((error) => { console.error(error); process.exit(3); });
