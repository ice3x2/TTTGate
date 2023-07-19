package com.snoworca.util;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;

public class ByteArrayListInputStream extends InputStream {

    private ArrayDeque<byte[]> buffers = new ArrayDeque<byte[]>();
    private byte[] currentBuffer = null;
    private int currentBufferPos = 0;

    public ByteArrayListInputStream() {
    }

    public void feed(byte[] buffer) {
        buffers.add(buffer);
    }

    private void cutCurrentBuffer() {
        if (currentBufferPos == 0) {
            return;
        }
        byte[] newBuffer = new byte[currentBuffer.length - currentBufferPos];
        System.arraycopy(currentBuffer, currentBufferPos, newBuffer, 0, newBuffer.length);
        currentBuffer = newBuffer;
        currentBufferPos = 0;
    }


    public void feedFirst(byte[] buffer) {
        if(currentBuffer != null) {
            cutCurrentBuffer();

        }


    }


    public void feedAll(ArrayList<byte[]> bufferList) {
        buffers.addAll(bufferList);
    }


    @Override
    public int read() throws IOException {
        if (currentBuffer == null || currentBufferPos >= currentBuffer.length) {
            currentBuffer = buffers.poll();
            if (currentBuffer == null) {
                return -1;
            }
            currentBufferPos = 0;
        }
        return currentBuffer[currentBufferPos++] & 0xff;
    }

    @Override
    public int read(byte[] b) throws IOException {
        return read(b, 0, b.length);
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        if (currentBuffer == null || currentBufferPos >= currentBuffer.length) {
            currentBuffer = buffers.poll();
            if (currentBuffer == null) {
                return -1;
            }
            currentBufferPos = 0;
        }
        int readLen = Math.min(len, currentBuffer.length - currentBufferPos);
        System.arraycopy(currentBuffer, currentBufferPos, b, off, readLen);
        currentBufferPos += readLen;
        return readLen;
    }

    @Override
    public long skip(long n) throws IOException {
        long skipped = 0;
        while (n > 0) {
            if (currentBuffer == null || currentBufferPos >= currentBuffer.length) {
                currentBuffer = buffers.poll();
                if (currentBuffer == null) {
                    return skipped;
                }
                currentBufferPos = 0;
            }
            long skipLen = Math.min(n, currentBuffer.length - currentBufferPos);
            currentBufferPos += skipLen;
            skipped += skipLen;
            n -= skipLen;
        }
        return skipped;
    }

    @Override
    public int available() throws IOException {
        int available = 0;
        if (currentBuffer != null) {
            available += currentBuffer.length - currentBufferPos;
        }
        for (byte[] buffer : buffers) {
            available += buffer.length;
        }
        return available;
    }

    @Override
    public void close() throws IOException {
        buffers.clear();
        currentBuffer = null;
        currentBufferPos = 0;
    }

    @Override
    public synchronized void mark(int readlimit) {
        throw new UnsupportedOperationException();
    }

    @Override
    public synchronized void reset() throws IOException {
        throw new UnsupportedOperationException();
    }

    @Override
    public boolean markSupported() {
        return false;
    }




}
