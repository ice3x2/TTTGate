

class DataStatePacket {


    public static readonly PACKET_DELIMITER = 'D';

    public static readonly PREFIX : string = "DATA_STATE";
    public static readonly PREFIX_LENGTH : number = Buffer.byteLength(DataStatePacket.PREFIX);
    public static readonly LENGTH : number = DataStatePacket.PREFIX_LENGTH + 4 + 4 + 4; // 10(DATA_STATE) + 4(CTRL_ID) + 4(HANDLER_ID) + 4(FIRST_SESSION_ID)
    public _handlerID : number;
    public _ctrlID : number;
    public _firstSessionID : number;
    public _bindingToken : string | undefined;

    private constructor() {}

    public get handlerID() : number { return this._handlerID; }
    public get ctrlID() : number { return this._ctrlID; }

    public get firstSessionID() : number { return this._firstSessionID; }
    public get bindingToken() : string | undefined { return this._bindingToken; }



    public static create(ctrlID: number, handlerID: number, firstSessionID: number, bindingToken?: string) : DataStatePacket {
        let packet = new DataStatePacket();
        packet._handlerID = handlerID;
        packet._ctrlID = ctrlID;
        packet._firstSessionID = firstSessionID;
        packet._bindingToken = bindingToken;
        return packet;
    }

    public toBuffer() : Buffer {
        const tokenBuffer = this._bindingToken ? Buffer.from(this._bindingToken, "utf-8") : Buffer.alloc(0);
        let buffer = Buffer.alloc(DataStatePacket.LENGTH + (this._bindingToken ? (2 + tokenBuffer.length) : 0));
        buffer.write(DataStatePacket.PREFIX,0,DataStatePacket.PREFIX_LENGTH);
        buffer.writeUInt32BE(this._ctrlID,DataStatePacket.PREFIX.length);
        buffer.writeUInt32BE(this._handlerID,DataStatePacket.PREFIX.length + 4);
        buffer.writeUInt32BE(this._firstSessionID,DataStatePacket.PREFIX.length + 8);
        if(this._bindingToken) {
            buffer.writeUInt16BE(tokenBuffer.length, DataStatePacket.LENGTH);
            tokenBuffer.copy(buffer, DataStatePacket.LENGTH + 2);
        }
        return buffer;
    }

    public static fromBuffer(buffer: Buffer) : { packet: DataStatePacket | undefined, remainBuffer: Buffer | undefined } {
        if(buffer.length < DataStatePacket.LENGTH) {
            return {packet: undefined, remainBuffer: buffer};
        }
        let prefix = buffer.toString('utf-8',0,DataStatePacket.PREFIX_LENGTH);
        if(prefix != DataStatePacket.PREFIX) {
            throw new Error(`fromBuffer: invalid prefix: ${prefix}`);
        }
        let packet = new DataStatePacket();
        packet._ctrlID = buffer.readUInt32BE(DataStatePacket.PREFIX_LENGTH);
        packet._handlerID = buffer.readUInt32BE(DataStatePacket.PREFIX_LENGTH + 4);
        packet._firstSessionID = buffer.readUInt32BE(DataStatePacket.PREFIX_LENGTH + 8);
        if(buffer.length === DataStatePacket.LENGTH) {
            return {packet: packet, remainBuffer: buffer.subarray(DataStatePacket.LENGTH)};
        }
        if(buffer.length < DataStatePacket.LENGTH + 2) {
            return {packet: undefined, remainBuffer: buffer};
        }
        const tokenLength = buffer.readUInt16BE(DataStatePacket.LENGTH);
        if(buffer.length < DataStatePacket.LENGTH + 2 + tokenLength) {
            return {packet: undefined, remainBuffer: buffer};
        }
        if(tokenLength > 0) {
            packet._bindingToken = buffer
                .subarray(DataStatePacket.LENGTH + 2, DataStatePacket.LENGTH + 2 + tokenLength)
                .toString("utf-8");
        }
        return {packet: packet, remainBuffer: buffer.subarray(DataStatePacket.LENGTH + 2 + tokenLength)};
    }






}

export default DataStatePacket;
