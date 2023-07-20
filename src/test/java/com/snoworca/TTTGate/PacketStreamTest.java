package com.snoworca.TTTGate;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PacketStreamTest {

    // make random string
    public static String randomString(int length) {
        String chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < length; i++) {
            builder.append(chars.charAt((int) (Math.random() * chars.length())));
        }
        return builder.toString();
    }

    @Test
    public void test() {
        String testString = randomString(2000);
        byte[] testBytes = testString.getBytes();
        TTTPacket testPacket1 = TTTPacket.createOpenPacket(100, 1231, "google.com", true);
        TTTPacket testPacket2 = TTTPacket.createDataPacket(101, testBytes);
        TTTPacket testPacket3 = TTTPacket.createClosePacket(101);
        TTTPacket testPacket5 = TTTPacket.createDataPacket(103, "hello world".getBytes());

        PacketStream packetStream = new PacketStream();

        packetStream.feed(testPacket1.toBytes());
        byte[] packet2Bytes = testPacket2.toBytes();
        ArrayList<byte[]> packet2BytesRandomSplitList = new ArrayList<>();
        // packet2Bytes to random split
        int packet2BytesLength = packet2Bytes.length;
        int packet2BytesRandomSplitCount = (int) (Math.random() * 10) + 1;
        int packet2BytesRandomSplitLength = packet2BytesLength / packet2BytesRandomSplitCount;
        for (int i = 0; i < packet2BytesRandomSplitCount; i++) {
            int start = i * packet2BytesRandomSplitLength;
            int end = (i + 1) * packet2BytesRandomSplitLength;
            if (i == packet2BytesRandomSplitCount - 1) {
                end = packet2BytesLength;
            }
            byte[] split = new byte[end - start];
            System.arraycopy(packet2Bytes, start, split, 0, end - start);
            packet2BytesRandomSplitList.add(split);
        }

        for (int i = 0, n = packet2BytesRandomSplitList.size(); i < n; i++) {
            byte[] split = packet2BytesRandomSplitList.get(i);

            if(i == n - 1) {
                TTTPacket result = packetStream.next(split).get();
                assertEquals(testPacket2.getData(), result.getData());
            }
            else
                assertTrue(packetStream.next(split).isEmpty());

        }

        packetStream.feed(testPacket3.toBytes());
        packetStream.feed("dsafasdfadsfdasf".getBytes());
        packetStream.feed(testPacket5.toBytes());





    }

}