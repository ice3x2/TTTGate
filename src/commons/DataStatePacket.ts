type FixedHeaderResult =
    | {kind: "incomplete"}
    | {kind: "invalid"; reason: string}
    | {kind: "complete"; ctrlID: number; handlerID: number; firstSessionID: number};

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

    public static readFixedHeader(buffer: Buffer): FixedHeaderResult {
        if(buffer.length < DataStatePacket.PREFIX_LENGTH) return {kind: "incomplete"};
        if(buffer.toString('utf-8', 0, DataStatePacket.PREFIX_LENGTH) !== DataStatePacket.PREFIX)
            return {kind: "invalid", reason: "Invalid data-state prefix"};
        if(buffer.length < DataStatePacket.LENGTH) return {kind: "incomplete"};
        return {kind: "complete", ctrlID: buffer.readUInt32BE(DataStatePacket.PREFIX_LENGTH),
            handlerID: buffer.readUInt32BE(DataStatePacket.PREFIX_LENGTH + 4),
            firstSessionID: buffer.readUInt32BE(DataStatePacket.PREFIX_LENGTH + 8)};
    }

    public static fromBuffer(buffer: Buffer, format: "legacy" | "token") : {
        packet: DataStatePacket | undefined, remainBuffer: Buffer | undefined, error?: string
    } {
        if(format !== "legacy" && format !== "token")
            return {packet: undefined, remainBuffer: undefined, error: "An explicit data-state format is required"};
        const header = this.readFixedHeader(buffer);
        if(header.kind === "incomplete") return {packet: undefined, remainBuffer: buffer};
        if(header.kind === "invalid") return {packet: undefined, remainBuffer: undefined, error: header.reason};
        let frameLength = DataStatePacket.LENGTH;
        let token: string | undefined;
        if(format === "token") {
            if(buffer.length < frameLength + 2) return {packet: undefined, remainBuffer: buffer};
            const tokenLength = buffer.readUInt16BE(frameLength);
            frameLength += 2 + tokenLength;
            if(buffer.length < frameLength) return {packet: undefined, remainBuffer: buffer};
            if(tokenLength > 0) token = buffer.toString("utf-8", DataStatePacket.LENGTH + 2, frameLength);
        }
        return {packet: DataStatePacket.create(header.ctrlID, header.handlerID, header.firstSessionID, token),
            remainBuffer: buffer.subarray(frameLength)};
    }






}

export default DataStatePacket;
