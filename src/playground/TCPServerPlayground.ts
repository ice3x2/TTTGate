import {TCPServer} from "../util/TCPServer";
import SocketState from "../util/SocketState";
import {Buffer} from "buffer";


let server : TCPServer = TCPServer.create({port: 1100, tls: false});

server.setOnServerEvent((inServer, state, handler) => {
    console.log("Server state: ", SocketState[state]);

    if(state == SocketState.Bound) {

    }


});


server.setOnHandlerEvent((handler, state, data) => {
    console.log(" > Handler state: ", handler.id, SocketState[state]);
    if(state == SocketState.Receive) {
        let buffer : Buffer = data as Buffer;

        let testCase = 10000;
        let totalSize = 0;
        let messges : Array<Buffer> = [];
        for(let i = 0; i < testCase; ++i) {
            let msg : Buffer = Buffer.from(`Hello World!![${handler.id}] - line: ${i}\n`);
            messges.push(msg);
            totalSize += msg.length;
        }


        let httpMessage = "HTTP/1.1 200 OK\r\n" +
                                 "Content-Type: text/plain\r\n" +
                                 "Content-Length: " +  totalSize + "\r\n" +
                                 "Connection: keep-alive\r\n\r\n";

        handler.sendData(Buffer.from(httpMessage))
        for(let i = 0; i < 10000; ++i) {
            handler.sendData(messges[i]);

        }
    }

});


server.start();