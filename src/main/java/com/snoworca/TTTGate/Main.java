package com.snoworca.TTTGate;

import io.vertx.core.Vertx;
import io.vertx.core.net.NetServer;

public class Main {
    public static void main(String[] args) {
        NetServer server = Vertx.vertx().createNetServer();

        server.connectHandler(socket -> {
            socket.handler(buffer -> {
                String message = buffer.toString().trim();
                System.out.println("Received message from client: " + message);
                // 클라이언트에게 응답 메시지 전송
                socket.write("Server: Message received");
                // 연결 종료
                socket.close();
            });


        });

        server.listen(8888, "localhost", handler -> {




            if (handler.succeeded()) {
                System.out.println("Server started on port 8888");
            } else {
                System.err.println("Server failed to start: " + handler.cause().getMessage());
            }
        });
    }
}
