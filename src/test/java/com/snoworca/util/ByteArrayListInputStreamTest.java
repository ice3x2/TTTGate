package com.snoworca.util;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Objects;
import java.util.concurrent.ThreadLocalRandom;

class ByteArrayListInputStreamTest {

    @Test
    public void test() throws IOException {
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        DataOutputStream dataOutputStream = new DataOutputStream(outputStream);
        // random write
        ThreadLocalRandom random = ThreadLocalRandom.current();
        ArrayList<Object> objectArrayList = new ArrayList<>();
        int count = random.nextInt(1000);
         for (int i = 0; i < count; i++) {
             int type = random.nextInt(4);
             switch (type) {
                 case 0:
                     boolean b = random.nextBoolean();
                        dataOutputStream.writeBoolean(b);
                        objectArrayList.add(b);
                     break;
                 case 1:
                        byte b1 = (byte) random.nextInt();
                        dataOutputStream.writeByte(b1);
                        objectArrayList.add(b1);

                     break;
                 case 2:
                     short s = (short) random.nextInt();
                        dataOutputStream.writeShort(s);
                        objectArrayList.add(s);

                     break;
                 case 3:
                     int i1 = random.nextInt();
                        dataOutputStream.writeInt(i1);
                        objectArrayList.add(i1);

                     break;
                 case 4:
                     long l = random.nextLong();
                        dataOutputStream.writeLong(l);
                        objectArrayList.add(l);
                     break;
                 case 5:
                     float f = random.nextFloat();
                        dataOutputStream.writeFloat(f);
                        objectArrayList.add(f);
                     break;
                 case 6:
                     double d = random.nextDouble();
                        dataOutputStream.writeDouble(d);
                        objectArrayList.add(d);
                     break;
                 case 7:
                     String test = "testtesttesttesttestt";

                        dataOutputStream.writeUTF(test);
                        objectArrayList.add(test);
                     break;
                 case 8:
                     String empty = "";

                        dataOutputStream.writeUTF(empty);
                        objectArrayList.add(empty);
                     break;
             }
         }
         byte[] bytes = outputStream.toByteArray();
        ArrayList<byte[]> byteArrayList = new ArrayList<>();
        // random split bytes
        int index = 0;
        while (index < bytes.length) {
            int length = random.nextInt(100);
            if (index + length > bytes.length) {
                length = bytes.length - index;
            }
            byte[] temp = new byte[length];
            System.arraycopy(bytes, index, temp, 0, length);
            byteArrayList.add(temp);
            index += length;
        }


        ByteArrayListInputStream stream = new ByteArrayListInputStream();
        DataInputStream dataInputStream = new DataInputStream(stream);
        stream.feedAll(byteArrayList);

        // test
        for (int i = 0; i < objectArrayList.size(); i++) {
            Object o = objectArrayList.get(i);
            if (o instanceof Boolean) {
                assert dataInputStream.readBoolean() == (Boolean) o;
            } else if (o instanceof Byte) {
                assert dataInputStream.readByte() == (Byte) o;
            } else if (o instanceof Short) {
                assert dataInputStream.readShort() == (Short) o;
            } else if (o instanceof Integer) {
                assert dataInputStream.readInt() == (Integer) o;
            } else if (o instanceof Long) {
                assert dataInputStream.readLong() == (Long) o;
            } else if (o instanceof Float) {
                assert dataInputStream.readFloat() == (Float) o;
            } else if (o instanceof Double) {
                assert dataInputStream.readDouble() == (Double) o;
            } else if (o instanceof String) {
                assert Objects.equals(dataInputStream.readUTF(), (String) o);
            }
        }




    }

}