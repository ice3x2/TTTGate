package com.snoworca.TTTGate.server;

import com.snoworca.TTTGate.PacketStream;
import com.snoworca.TTTGate.TTTPacket;
import com.snoworca.TTTGate.OnTransferListener;
import com.snoworca.TTTGate.TransferState;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.ByteToMessageDecoder;
import io.netty.handler.codec.MessageToByteEncoder;

import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

public class TunnelServer {



    private EventLoopGroup bossGroup = new NioEventLoopGroup(1);
    private EventLoopGroup workerGroup = new NioEventLoopGroup();

    private ConcurrentHashMap<Integer, ChannelHandlerContext> channels = new ConcurrentHashMap<>();
    private OnTransferListener event;




    public void start() {
        ServerBootstrap bootstrap = new ServerBootstrap();
        bootstrap.group(bossGroup, workerGroup)
                .channel(NioServerSocketChannel.class)
                .childHandler(initializer);

        ChannelFuture future = bootstrap.bind(8888);
    }

    private ChannelInitializer<SocketChannel> initializer = new ChannelInitializer<SocketChannel>() {
        @Override
        public void initChannel(SocketChannel ch) {
            ChannelPipeline pipeline = ch.pipeline();
            pipeline.addLast(new TTTPacketDecoder());
            //pipeline.addLast(new TunnelServer.PortServerHandler(TunnelServer.this));
            pipeline.addLast(new TTTPacketEncoder());


        }
    };



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

    public boolean send(int id, byte[] data) {
        ChannelHandlerContext ctx = channels.get(id);
        if(ctx != null) {
            ctx.writeAndFlush(Unpooled.copiedBuffer(data));
            return true;
        }
        return false;
    }




    public static class TTTPacketEncoder extends MessageToByteEncoder<TTTPacket> {
        @Override
        protected void encode(ChannelHandlerContext ctx, TTTPacket msg, ByteBuf out) throws Exception {
            out.writeBytes(TTTPacket.Prefix());
            out.writeInt(msg.getId());
            out.writeByte(msg.getCommand());
            out.writeInt(msg.getData().length);
            if (msg.getData().length > 0) {
                out.writeBytes(msg.getData());
            }
        }
    }

    public static class TTTPacketDecoder extends ByteToMessageDecoder {

        private PacketStream stream = new PacketStream();
        @Override
        protected void decode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) throws Exception {
            byte[] data = new byte[in.readableBytes()];
            in.readBytes(data);
            stream.next(data).ifPresent(out::add);
        }

    }


    private static class PortServerHandler extends ChannelInboundHandlerAdapter {

        private PacketStream stream = new PacketStream();



        @Override
        public void channelActive(ChannelHandlerContext ctx) throws Exception {
            super.channelActive(ctx);

        }

        @Override
        public void channelRead(ChannelHandlerContext ctx, Object msg) {
            ByteBuf buf = (ByteBuf) msg;
            byte[] data = new byte[buf.readableBytes()];

        }

        @Override
        public void channelInactive(ChannelHandlerContext ctx) throws Exception {
            super.channelInactive(ctx);

        }

        @Override
        public void channelUnregistered(ChannelHandlerContext ctx) throws Exception {
            super.channelUnregistered(ctx);

        }


        @Override
        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            cause.printStackTrace();
            ctx.close();
        }
    }
}
