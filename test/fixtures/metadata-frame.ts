import {CtrlCmd, CtrlPacket} from '../../src/commons/CtrlPacket';
export function metadataFrame(cmd: CtrlCmd, payload: string, id = 1, session = 0) {
    const header = CtrlPacket.createSyncCtrl().toBuffer();
    header[CtrlPacket.PREFIX_LEN] = cmd;
    header.writeUInt16BE(id & 65535, CtrlPacket.PREFIX_LEN + 1);
    header.writeUInt32BE(session, CtrlPacket.PREFIX_LEN + 3);
    const bytes = Buffer.from(payload); header.writeUInt32BE(bytes.length, CtrlPacket.HEADER_LEN - 4);
    return Buffer.concat([header, bytes]);
}
