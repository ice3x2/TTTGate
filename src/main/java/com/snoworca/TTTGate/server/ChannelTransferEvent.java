package com.snoworca.TTTGate.server;

import com.snoworca.TTTGate.TransferState;
import io.netty.channel.ChannelHandlerContext;

public interface ChannelTransferEvent {
    void onEvent(ChannelHandlerContext ctx, int id, TransferState state, byte[] data);
}
