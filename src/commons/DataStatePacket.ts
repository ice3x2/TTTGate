

class DataStatePacket {


    public static readonly PACKET_DELIMITER = 'D';

    public static readonly PREFIX : string = "DATA_STATE";
    public static readonly PREFIX_LENGTH : number = Buffer.byteLength(DataStatePacket.PREFIX);
    public static readonly LENGTH : number = DataStatePacket.PREFIX_LENGTH + 4 + 4 + 4; // 10(DATA_STATE) + 4(CTRL_ID) + 4(HANDLER_ID) + 4(FIRST_SESSION_ID)
    public _handlerID : number;
    public _ctrlID : number;
    public _firstSessionID : number;

    private constructor() {}

    public get handlerID() : number { return this._handlerID; }
    public get ctrlID() : number { return this._ctrlID; }

    public get firstSessionID() : number { return this._firstSessionID; }



    public static create(ctrlID: number, handlerID: number, firstSessionID: number) : DataStatePacket {
        let packet = new DataStatePacket();
        packet._handlerID = handlerID;
        packet._ctrlID = ctrlID;
        packet._firstSessionID = firstSessionID;
        return packet;
    }

    public toBuffer() : Buffer {
        let buffer = Buffer.alloc(DataStatePacket.LENGTH);
        buffer.write(DataStatePacket.PREFIX,0,DataStatePacket.PREFIX_LENGTH);
        buffer.writeUInt32BE(this._ctrlID,DataStatePacket.PREFIX.length);
        buffer.writeUInt32BE(this._handlerID,DataStatePacket.PREFIX.length + 4);
        buffer.writeUInt32BE(this._firstSessionID,DataStatePacket.PREFIX.length + 8);
        return buffer;
    }

    public static fromBuffer(buffer: Buffer) : { packet: DataStatePacket | undefined, remainBuffer: Buffer | undefined } {
        if(buffer.length < DataStatePacket.LENGTH) {
            return {packet: undefined, remainBuffer: buffer};
        }
        let prefix = buffer.toString('utf-8',0,DataStatePacket.PREFIX_LENGTH);
        if(prefix != DataStatePacket.PREFIX) {
            throw new Error(`DataStatePacket::fromBuffer: invalid prefix: ${prefix}`);
        }
        let packet = new DataStatePacket();
        packet._ctrlID = buffer.readUInt32BE(DataStatePacket.PREFIX_LENGTH);
        packet._handlerID = buffer.readUInt32BE(DataStatePacket.PREFIX_LENGTH + 4);
        packet._firstSessionID = buffer.readUInt32BE(DataStatePacket.PREFIX_LENGTH + 8);

        return {packet: packet, remainBuffer: buffer.subarray(DataStatePacket.LENGTH)};
    }






}

export default DataStatePacket;