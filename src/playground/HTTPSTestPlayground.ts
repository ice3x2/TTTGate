import { SocketHandler } from  "../util/SocketHandler";
import ConnectOpt from "../util/ConnectOpt";
import SocketState from "../util/SocketState";


let event = (h: SocketHandler, state: SocketState, data?: Buffer) => {
    console.log(`handler event : ${h.id} ${SocketState[state]} ${data}`);
    if(state == SocketState.Connected) {
        h.sendData(Buffer.from("GET / HTTP/1.1\r\nHost: www.naver.com\r\nConnection: close\r\n\r\n"));
    }
    else if(state == SocketState.Receive) {
        console.log(data?.toString());
    }
    else {
        process.exit(0)
    }




}

let handler : SocketHandler = SocketHandler.connect({host: "www.naver.com",port: 443,tls: true}, event);