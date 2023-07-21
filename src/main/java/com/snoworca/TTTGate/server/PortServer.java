package com.snoworca.TTTGate.server;

import com.snoworca.TTTGate.OnTransferListener;
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
    private EventLoopGroup workerGroup = new NioEventLoopGroup(100);

    private ConcurrentHashMap<Integer, ChannelHandlerContext> channels = new ConcurrentHashMap<>();
    private OnTransferListener event;

    public static PortServer create() {
        return new PortServer();
    }


    private PortServer() {

    }

    public ChannelFuture start(int port, OnTransferListener event) {
        this.event = event;
        ServerBootstrap bootstrap = new ServerBootstrap();
        bootstrap.group(bossGroup, workerGroup)
                .channel(NioServerSocketChannel.class)
                .childHandler(channelChannelInitializer);



        ChannelFuture future = bootstrap.bind(port);
        return future;
    }

    private final ChannelInitializer<SocketChannel> channelChannelInitializer = new ChannelInitializer<SocketChannel>() {
        @Override
        public void initChannel(SocketChannel ch) {
            ChannelPipeline pipeline = ch.pipeline();
            pipeline.addLast(new PortServerHandler(PortServer.this::event));
        }
    };


    private void event(ChannelHandlerContext ctx, int id, TransferState state, byte[] data) {
        workerGroup.execute(()-> {
            System.out.println("tid: " + Thread.currentThread().getId() + " id: " + id);
            if(state == TransferState.Open) {
                channels.put(id, ctx);
                event.onEvent(id, state, null);
            } else if(state == TransferState.Close) {
                event.onEvent(id, state, null);
                channels.remove(id);
            } else if(state == TransferState.Receive) {
                event.onEvent(id, state, data);
                channels.remove(id);
            }
        });

    }

    public void closeClient(int id) {
        ChannelHandlerContext ctx = channels.get(id);
        if(ctx != null) {
            ctx.close();
        }
    }

    public boolean send(int id, byte[] data) {
        ChannelHandlerContext ctx = channels.get(id);
        if(ctx != null) {
            ctx.channel().writeAndFlush(Unpooled.copiedBuffer(data));

            return true;
        }
        return false;
    }


    private static class PortServerHandler extends ChannelInboundHandlerAdapter {

        private final static AtomicInteger TopID = new AtomicInteger(0);
        private final int id = TopID.getAndIncrement();
        private ChannelTransferEvent event;

        private boolean connected = false;

        PortServerHandler(ChannelTransferEvent event) {
            this.event = event;
        }


        @Override
        public void channelActive(ChannelHandlerContext ctx) throws Exception {
            super.channelActive(ctx);
            this.connected = true;
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
        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            cause.printStackTrace();
            ctx.close();
            callClose(ctx);
        }

        private void callClose(ChannelHandlerContext ctx) {
            if(connected) {
                event.onEvent(ctx, id, TransferState.Close, null);
                connected = false;
            }
        }

        @Override
        public void channelInactive(ChannelHandlerContext ctx) throws Exception {
            super.channelInactive(ctx);
            callClose(ctx);
        }

        @Override
        public void channelUnregistered(ChannelHandlerContext ctx) throws Exception {
            super.channelUnregistered(ctx);
            callClose(ctx);
        }


    }

}
