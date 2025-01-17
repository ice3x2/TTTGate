/// <reference types="node" />
declare class DataStatePacket {
    static readonly PACKET_DELIMITER = "D";
    static readonly PREFIX: string;
    static readonly PREFIX_LENGTH: number;
    static readonly LENGTH: number;
    _handlerID: number;
    _ctrlID: number;
    _firstSessionID: number;
    private constructor();
    get handlerID(): number;
    get ctrlID(): number;
    get firstSessionID(): number;
    static create(ctrlID: number, handlerID: number, firstSessionID: number): DataStatePacket;
    toBuffer(): Buffer;
    static fromBuffer(buffer: Buffer): {
        packet: DataStatePacket | undefined;
        remainBuffer: Buffer | undefined;
    };
}
export default DataStatePacket;
