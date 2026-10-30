// #260 — 인증 전 연결이 [Message, SyncCtrl] 묶음을 보내도 서버 프로세스가 살아 있어야 한다.
// 실패하면 프로세스가 죽으므로 jest 밖의 자식 프로세스로 돌린다.
import net from "node:net";
import TTTServer from "../../../src/server/TTTServer";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import {CtrlPacket} from "../../../src/commons/CtrlPacket";
import {DEFAULT_KEY, ServerOption} from "../../../src/types/TunnelingOption";
import {getFreePort} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "../../helpers/runtime";

const sendAndClose = (port: number, chunk: Buffer): Promise<void> => new Promise((resolve) => {
    const socket = net.createConnection({host: "127.0.0.1", port});
    socket.on("error", () => {});
    socket.once("connect", () => socket.write(chunk));
    socket.once("close", () => resolve());
    setTimeout(() => socket.destroy(), 500);
});

const ackArrives = (port: number): Promise<boolean> => new Promise((resolve) => {
    const socket = net.createConnection({host: "127.0.0.1", port});
    socket.on("error", () => resolve(false));
    socket.once("connect", () => socket.write(CtrlPacket.createSyncCtrl().toBuffer()));
    socket.once("data", () => { socket.destroy(); resolve(true); });
    setTimeout(() => { socket.destroy(); resolve(false); }, 5_000);
});

const main = async () => {
    const testRoot = await createTestRoot("write-after-end-driver");
    applyTestRoot(testRoot.rootDir);
    await CertificationStore.instance.load();
    const port = await getFreePort();
    const option: ServerOption = {key: DEFAULT_KEY, adminPort: 9300, adminBindHost: "127.0.0.1", adminTls: true, port, tls: false,
        tunnelingOptions: [], keepAlive: 0, globalMemCacheLimit: 128};
    ServerOptionStore.instance.updateServerOption(option);
    const server = TTTServer.create(ServerOptionStore.instance.serverOption);
    await server.start();
    const chunk = Buffer.concat([CtrlPacket.message(0, {type: "x", payload: "y"}), CtrlPacket.createSyncCtrl()].map((packet) => packet.toBuffer()));
    for(let n = 0; n < 20; n++) await sendAndClose(port, chunk);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pending = ((server as any)._tunnelServer._pendingControlHandshakeMap as Map<number, unknown>).size;
    const alive = await ackArrives(port);
    await server.close();
    await cleanupTestRoot(testRoot);
    console.log(JSON.stringify({result: "SURVIVED", alive, pending}));
    process.exit(0);
};

main().catch((error) => { console.error(error); process.exit(3); });
