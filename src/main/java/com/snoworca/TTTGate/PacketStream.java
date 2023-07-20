package com.snoworca.TTTGate;


import com.snoworca.TTTGate.util.ByteArrayListInputStream;
import lombok.SneakyThrows;

import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Optional;

public class PacketStream {

    private ByteArrayListInputStream inputStream = new ByteArrayListInputStream();
    private DataInputStream dataInputStream = new DataInputStream(inputStream);

    private boolean readDataMode = false;

    private int readDataLength = 0;
    private int command = -1;
    private int id = -1;

    public void feed(byte[] packet) {
        inputStream.feed(packet);
    }

    public Optional<TTTPacket> next(byte[] packet) {
        inputStream.feed(packet);
        TTTPacket tttPacket = readPacket();
        if(tttPacket == null) {
            return Optional.empty();
        }
        return Optional.of(tttPacket);
    }

    @SneakyThrows(IOException.class)
    public TTTPacket readPacket() {
        if(!readDataMode) {
            if (inputStream.available() < TTTPacket.HeaderLength()) {
                return null;
            }
            byte[] prefix = TTTPacket.Prefix();
            for (int i = 0; i < prefix.length - 1; i++) {
                byte b = dataInputStream.readByte();
                if (b == prefix[i]) {
                    continue;
                }
                return null;
            }
            id = dataInputStream.readInt();
            command = dataInputStream.readByte();
            if (!TTTPacket.availableCmd(command)) {
                return null;
            }
            readDataLength = dataInputStream.readInt();
            if (readDataLength < 0) {
                return null;
            }
        }
        byte[] data = new byte[0];
        readDataMode = true;
        if(inputStream.available() < readDataLength) {
            return null;
        }
        if(readDataLength > 0) {
            data = new byte[readDataLength];
            dataInputStream.readFully(data);
        }
        readDataMode = false;
        TTTPacket packet = new TTTPacket();
        switch (command) {
            case TTTPacket.CMD_OPEN:
                return makeOpenPacket(id, data);
            case TTTPacket.CMD_DATA:
                return TTTPacket.createDataPacket(id, data);
            case TTTPacket.CMD_CLOSE:
                return TTTPacket.createClosePacket(id);
        }
        return null;
    }


    @SneakyThrows(IOException.class)
    private TTTPacket makeOpenPacket(int id, byte[] buffer) {
        DataInputStream dataInputStream = new DataInputStream(new ByteArrayInputStream(buffer));
        /**
         * 4byte : port
         * 1byte : ssl
         * 1byte : host length
         * nbyte : host (utf-8)
         */
        int port = dataInputStream.readInt();
        boolean ssl = dataInputStream.readByte() == 1;
        int hostLength = dataInputStream.readByte();
        byte[] hostBytes = new byte[hostLength];
        dataInputStream.readFully(hostBytes);
        String host = new String(hostBytes, StandardCharsets.UTF_8);
        return TTTPacket.createOpenPacket(id, port, host, ssl);
    }






}
