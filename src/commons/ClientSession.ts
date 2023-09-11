import SessionState from "../option/SessionState";
import {ConnectOpt} from "../option/ConnectOpt";
import Session from "./Session";


class ClientSession extends Session {

    public controlId : number;
    public connectOpt : ConnectOpt =  {host: "", port: 0, tls: false};

    public static createClientSession(id: number) : ClientSession {
        //console.log("[server]",`ControlSession: create: ${id}`);
        let session = new ClientSession(id);
        return session;
    }

    constructor(id: number) {
        super(id);
    }


}

export default ClientSession;