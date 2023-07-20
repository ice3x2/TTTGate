package com.snoworca.TTTGate;

import io.netty.channel.ChannelHandlerContext;

public interface TransferEvent {
    void onEvent(int id, TransferState state, byte[] data);
}
