import net from "node:net";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import {CtrlCmd, CtrlPacket, CtrlPacketStreamer} from "../../../src/commons/CtrlPacket";
import DataStatePacket from "../../../src/commons/DataStatePacket";
import {buildHandshakeProof, CONTROL_PROTOCOL_V2, DEFAULT_PROTOCOL_V2_CAPABILITIES} from "../../../src/commons/ProtocolV2";
import {ClientHandlerPool} from "../../../src/server/ClientHandlerPool";
import {CertificationStore} from "../../../src/server/CertificationStore";
import ServerOptionStore from "../../../src/server/ServerOptionStore";
import TTTServer from "../../../src/server/TTTServer";
import {DEFAULT_KEY} from "../../../src/types/TunnelingOption";
import {getFreePort, startEchoServer} from "../../helpers/network";
import {applyTestRoot, cleanupTestRoot, createTestRoot} from "../../helpers/runtime";

export async function until(condition: () => boolean, message: string) {
    const deadline = Date.now() + 3000;
    while(!condition()) {
        if(Date.now() >= deadline) throw new Error(message);
        await delay(5);
    }
}

export async function withLegacyIds(check: (fixture: Awaited<ReturnType<typeof setup>>['fixture']) => Promise<void>) {
    const scope = await setup();
    try { await check(scope.fixture); } finally { await scope.close(); }
}

async function setup() {
    const root = await createTestRoot('handler-ids-41');
    const sockets: net.Socket[] = [];
    let server: TTTServer | undefined;
    let echo: Awaited<ReturnType<typeof startEchoServer>> | undefined;
    const originalWide = (ClientHandlerPool as any).LAST_DATA_HANDLER_ID;
    const close = async () => {
        sockets.forEach(socket => socket.destroy());
        try { await server?.close(); } finally {
            try { await echo?.close(); } finally {
                (ClientHandlerPool as any).LAST_DATA_HANDLER_ID = originalWide;
                await cleanupTestRoot(root);
            }
        }
    };
    const connect = async (port: number) => {
        const socket = net.createConnection({host: '127.0.0.1', port});
        sockets.push(socket);
        socket.on('error', () => {});
        await once(socket, 'connect');
        return socket;
    };
    try {
        applyTestRoot(root.rootDir);
        await CertificationStore.instance.load();
        echo = await startEchoServer();
        const controlPort = await getFreePort(), legacyPort = await getFreePort(), widePort = await getFreePort();
        const store = ServerOptionStore.instance;
        if(!store.updateServerOption({...store.serverOption, key: DEFAULT_KEY, port: controlPort,
            adminTls: true, tls: false, keepAlive: 0, controlProtocolMode: 'mixed', allowLegacyControlAuth: true,
            trustedClients: [{clientId: 'wide', clientSecret: 'fixture-wide-secret', displayName: 'wide'}],
            tunnelingOptions: [legacyPort, widePort].map((forwardPort, i) => ({forwardPort, protocol: 'tcp', tls: false,
                destinationAddress: '127.0.0.1', destinationPort: echo!.port, keepAlive: 0,
                allowedClientNames: [i === 0 ? 'legacy' : 'wide']}))})) throw new Error('Invalid fixture configuration');
        server = TTTServer.create(store.serverOption);
        await server.start();

        const peer = async (wide = false) => {
            const control = await connect(controlPort);
            const packets: CtrlPacket[] = [];
            const streamer = new CtrlPacketStreamer();
            control.on('data', data => packets.push(...streamer.readCtrlPacketList(data)));
            const read = async (cmd: CtrlCmd, sessionID?: number) => {
                const index = () => packets.findIndex(packet => packet.cmd === cmd && (sessionID === undefined || packet.sessionID === sessionID));
                await until(() => index() >= 0, `Missing ${CtrlCmd[cmd]} for ${sessionID}`);
                return packets.splice(index(), 1)[0];
            };
            control.write(CtrlPacket.createSyncCtrl().toBuffer());
            const ack = await read(CtrlCmd.SyncCtrlAck);
            const controlID = wide ? ack.syncCtrlAckMeta!.controlID! : ack.ID;
            control.write(CtrlPacket.createAckCtrl(ack.ID, wide ? 'wide' : 'legacy', DEFAULT_KEY, wide ? {
                protocolVersion: CONTROL_PROTOCOL_V2, capabilities: DEFAULT_PROTOCOL_V2_CAPABILITIES,
                controlID, clientId: 'wide', displayName: 'wide',
                proof: buildHandshakeProof('fixture-wide-secret', 'wide', controlID, ack.syncCtrlAckMeta!.challengeNonce),
            } : undefined).toBuffer());
            await until(() => server!.clientStatus().some(status => status.name === (wide ? 'wide' : 'legacy')), 'Control identity missing');
            const pool = (server!.tunnelServer as any)._clientHandlerPoolMap.get(controlID) as ClientHandlerPool;
            const open = async () => {
                const socket = await connect(wide ? widePort : legacyPort);
                const received: Buffer[] = [];
                socket.on('data', bytes => received.push(Buffer.from(bytes)));
                const packet = await read(CtrlCmd.NewDataHandler);
                return {socket, packet, received};
            };
            const handover = async (packet: CtrlPacket, sessionID = packet.sessionID, handlerID = wide ? packet.newDataHandlerMeta!.handlerID : packet.ID) => {
                const data = await connect(controlPort);
                data.write(DataStatePacket.create(controlID, handlerID, sessionID, wide ? packet.newDataHandlerMeta?.bindingToken : undefined).toBuffer());
                return data;
            };
            const complete = async (session: Awaited<ReturnType<typeof open>>) => {
                const data = await handover(session.packet);
                const instruction = await read(CtrlCmd.OpenSession, session.packet.sessionID);
                const endpoint = await connect(instruction.openOpt!.port);
                data.pipe(endpoint).pipe(data);
                control.write(CtrlPacket.resultOfOpenSession(instruction.ID, instruction.sessionID, true,
                    wide ? {handlerID: session.packet.newDataHandlerMeta!.handlerID} : undefined).toBuffer());
                await read(CtrlCmd.SuccessOfOpenSessionAck, instruction.sessionID);
                return data;
            };
            const roundtrip = async (session: Awaited<ReturnType<typeof open>>, marker: string) => {
                const offset = Buffer.concat(session.received).length;
                session.socket.write(marker);
                await until(() => Buffer.concat(session.received).length >= offset + marker.length, 'Endpoint echo did not arrive');
                expect(Buffer.concat(session.received).subarray(offset).toString()).toBe(marker);
            };
            return {control, pool, packets, read, open, handover, complete, roundtrip};
        };
        return {fixture: {server, peer}, close};
    } catch(error) { await close(); throw error; }
}
