package com.snoworca.TTTGate;


import com.snoworca.TTTGate.server.PortServer;

public class Main {

    static int num = 0;
    public static void main(String[] args) throws InterruptedException {

        PortServer portServer = PortServer.create();

        portServer.start(9010, (id, state, data) -> {
            if(state == TransferState.Open) {
                System.out.println("id: " + id + " open");
            }
            else if(state == TransferState.Receive) {
                    System.out.println("id: " + id + " Receive::" + new String(data));
                    String message = "<html><body><h1>ID:" + id + "</h1></body></html>";
                    portServer.send(id, ("HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nContent-Type: text/html\r\nContent-Length: " + message.getBytes().length + "\r\n\r\n").getBytes());
                    portServer.send(id, message.getBytes());
            }
            else if(state == TransferState.Close) {
                System.out.println("id: " + id + " close");
            }
        }).addListener((future)->{
            if(future.isSuccess()){
                System.out.println("Server started");
            }else{
                future.cause().printStackTrace();
            }
        }).sync();

    }
}
