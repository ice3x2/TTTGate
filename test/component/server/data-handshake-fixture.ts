import net from "node:net";
import {once} from "node:events";
import {CtrlCmd, CtrlPacket} from "../../../src/commons/CtrlPacket";
import DataStatePacket from "../../../src/commons/DataStatePacket";
import {withLegacyIds, until} from "./legacy-handler-id-fixture";

export const withHandshake = (wide: boolean, check: (fixture: any) => Promise<void>) => withLegacyIds(async f => {
    const peer = await f.peer(wide);
    const session = await peer.open();
    const tunnel = f.server.tunnelServer as any;
    const receive = tunnel.onReceiveDataHandler;
    const sockets: net.Socket[] = [];
    const observations: Array<{handler: any, bytes: number}> = [];
    tunnel.onReceiveDataHandler = (handler: any, data: Buffer) => {
        receive.call(tunnel, handler, data);
        observations.push({handler, bytes: data.length});
    };
    const connect = async (port: number) => {
        const socket = net.createConnection({host: '127.0.0.1', port});
        sockets.push(socket); socket.on('error', () => {});
        await once(socket, 'connect'); return socket;
    };
    try {
        const socket = await connect(tunnel.port);
        const frame = DataStatePacket.create(peer.pool.id,
            wide ? session.packet.newDataHandlerMeta!.handlerID : session.packet.ID,
            session.packet.sessionID, wide ? session.packet.newDataHandlerMeta?.bindingToken : undefined).toBuffer();
        const received = () => observations.reduce((sum, observation) => sum + observation.bytes, 0);
        const finish = async () => {
            const opened = await peer.read(CtrlCmd.OpenSession, session.packet.sessionID);
            const endpoint = await connect(opened.openOpt!.port);
            socket.pipe(endpoint).pipe(socket);
            peer.control.write(CtrlPacket.resultOfOpenSession(opened.ID, opened.sessionID, true,
                wide ? {handlerID: session.packet.newDataHandlerMeta!.handlerID} : undefined).toBuffer());
            await peer.read(CtrlCmd.SuccessOfOpenSessionAck, opened.sessionID);
        };
        await check({f, peer, session, socket, frame, tunnel, observations, received, finish, until});
    } finally {
        tunnel.onReceiveDataHandler = receive;
        sockets.forEach(socket => socket.destroy());
    }
});
