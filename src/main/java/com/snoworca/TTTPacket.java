package com.snoworca;

import lombok.Getter;
import lombok.SneakyThrows;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.charset.StandardCharsets;


public class TTTPacket {
    public static final int CMD_DATA = 0;
    public static final int CMD_OPEN = 1;
    public static final int CMD_CLOSE = 2;

    private static String PREFIX_STR = "TtTGate";
    private static byte[] PREFIX = PREFIX_STR.getBytes();
    private static int PREFIX_LEN = PREFIX.length;
    /**
     * n bytes: prefix
     * 4 bytes: id
     * 1 byte: command
     * 4 bytes: length of data
     */

    private static int HEADER_LEN = PREFIX_LEN + 4 + 1 + 4;

    public static boolean availableCmd(int cmd) {
        return cmd == CMD_DATA || cmd == CMD_OPEN || cmd == CMD_CLOSE;
    }

    public static int HeaderLength() {
        return HEADER_LEN;
    }

    public static byte[] Prefix() {
        return PREFIX;
    }

    @Getter
    private int id;

    @Getter
    private int port;

    @Getter
    private String host;

    @Getter
    private boolean ssl;

    @Getter
    private int command;

    @Getter
    private byte[] data;

    @SneakyThrows
    public static TTTPacket createOpenPacket(int id,int port, String host, boolean ssl) {
        TTTPacket packet = new TTTPacket();
        packet.id = id;
        packet.command = CMD_OPEN;
        packet.port = port;
        packet.host = host;
        packet.ssl = ssl;
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try(DataOutputStream dos = new DataOutputStream(baos)) {
            /**
             * 4byte : port
             * 1byte : ssl
             * 1byte : host length
             * nbyte : host (utf-8)
             */
            dos.writeInt(port);
            dos.writeBoolean(ssl);
            byte[] hostBytes = host.getBytes(StandardCharsets.UTF_8);
            dos.writeByte(hostBytes.length);
            dos.write(hostBytes);
        }
        packet.data = baos.toByteArray();
        return packet;
    }

    public static TTTPacket createClosePacket(int id) {
        TTTPacket packet = new TTTPacket();
        packet.id = id;
        packet.command = CMD_CLOSE;
        return packet;
    }

    public static TTTPacket createDataPacket(int id, byte[] data) {
        TTTPacket packet = new TTTPacket();
        packet.id = id;
        packet.command = CMD_DATA;
        packet.data = data;
        return packet;
    }



    @SneakyThrows
    public byte[] toBytes() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try(DataOutputStream dos = new DataOutputStream(baos)) {
            dos.write(PREFIX);
            dos.writeInt(id);
            dos.writeByte(command);
            dos.writeInt(data.length);
            if(data.length > 0) {
                dos.write(data);
            }
        }
        return baos.toByteArray();
    }


}