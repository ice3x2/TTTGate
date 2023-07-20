package com.snoworca.TTTGate.server;

import com.snoworca.TTTGate.TransferEvent;
import com.snoworca.TTTGate.TransferState;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

public class PortServer {


    private EventLoopGroup bossGroup = new NioEventLoopGroup(1);
    private EventLoopGroup workerGroup = new NioEventLoopGroup();

    private ConcurrentHashMap<Integer, ChannelHandlerContext> channels = new ConcurrentHashMap<>();
    private TransferEvent event;




    public void start() {
        ServerBootstrap bootstrap = new ServerBootstrap();
        bootstrap.group(bossGroup, workerGroup)
                .channel(NioServerSocketChannel.class)
                .childHandler(new ChannelInitializer<SocketChannel>() {
                    @Override
                    public void initChannel(SocketChannel ch) {
                        PortServer.this.initChannel(ch);
                    }
                });

        ChannelFuture future = bootstrap.bind(8888);
    }

    private void initChannel(SocketChannel ch) {
        ChannelPipeline pipeline = ch.pipeline();
        pipeline.addLast(new PortServerHandler(PortServer.this::event));
    }

    private void event(ChannelHandlerContext ctx, int id, TransferState state, byte[] data) {
        if(state == TransferState.Open) {
            channels.put(id, ctx);
        } else if(state == TransferState.Close) {
            event.onEvent(id, state, null);
            channels.remove(id);
        } else if(state == TransferState.Receive) {
            event.onEvent(id, state, data);
        }
    }

    public void closeClient(int id) {
        ChannelHandlerContext ctx = channels.get(id);
        if(ctx != null) {
            ctx.close();
        }
    }

    public void send(int id, byte[] data) {
        ChannelHandlerContext ctx = channels.get(id);
        if(ctx != null) {
            ctx.writeAndFlush(Unpooled.copiedBuffer(data));
        }
    }


    private static class PortServerHandler extends ChannelInboundHandlerAdapter {

        private final static AtomicInteger TopID = new AtomicInteger(0);
        private final int id = TopID.getAndIncrement();
        private ChannelTransferEvent event;

        PortServerHandler(ChannelTransferEvent event) {
            this.event = event;
        }


        @Override
        public void channelActive(ChannelHandlerContext ctx) throws Exception {
            super.channelActive(ctx);
            event.onEvent(ctx, id, TransferState.Open, null);
        }


        @Override
        public void channelRead(ChannelHandlerContext ctx, Object msg) {
            ByteBuf buf = (ByteBuf) msg;
            byte[] data = new byte[buf.readableBytes()];
            buf.readBytes(data);
            event.onEvent(ctx, id, TransferState.Receive, data);
            buf.release();
        }

        @Override
        public void channelInactive(ChannelHandlerContext ctx) throws Exception {
            super.channelInactive(ctx);
            event.onEvent(ctx, id, TransferState.Close, null);
        }

        @Override
        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            cause.printStackTrace();
            ctx.close();
        }
    }


}
