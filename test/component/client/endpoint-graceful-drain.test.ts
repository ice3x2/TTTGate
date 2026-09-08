import net from 'node:net';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {withClient} from './data-terminal-fixture';
import {until} from '../server/legacy-handler-id-fixture';
import {SocketHandler} from '../../../src/util/SocketHandler';
import {FileCache} from '../../../src/util/FileCache';
import EndPointClientPool from '../../../src/client/EndPointClientPool';
import SocketState from '../../../src/util/SocketState';
import ServerOptionStore from '../../../src/server/ServerOptionStore';
import {CtrlPacketStreamer, CtrlCmd} from '../../../src/commons/CtrlPacket';

jest.setTimeout(30_000);
const wait = async (predicate: () => boolean, label: string, ms=5000) => {
    const end=Date.now()+ms;
    while(!predicate()){if(Date.now()>end) throw new Error(label);await new Promise<void>(r=>setTimeout(r,5));}
};

test('normal endpoint EOF drains real cached response before external FIN and sends one close', async () => withClient(async h => {
    const payload=Buffer.alloc(8*1024*1024,0x73), responses: Buffer[]=[];
    const expected=createHash('sha256').update(payload).digest('hex');
    const prior=SocketHandler.maxGlobalMemoryBufferSize, sockets: net.Socket[]=[];
    const write=FileCache.prototype.writeSync, read=FileCache.prototype.readSync;
    let writes=0,reads=0,done=false,failure: unknown,ended=false;
    FileCache.prototype.writeSync=function(bytes){const r=write.call(this,bytes);if(r.id>=0)writes+=bytes.length;return r;};
    FileCache.prototype.readSync=function(id){const r=read.call(this,id);if(r)reads+=r.length;return r;};
    const endpoint=net.createServer(socket=>{
        sockets.push(socket);socket.on('error',()=>{});
        socket.once('data',()=>{
            const run=async()=>{for(let p=0;p<payload.length;p+=65536){if(!socket.write(payload.subarray(p,p+65536)))await once(socket,'drain');}socket.end();done=true;};
            run().catch(error=>{failure=error;});
        });
    });
    endpoint.listen(0,'127.0.0.1');await once(endpoint,'listening');
    const open=h.tunnel._onConnectEndPointCallback, send=h.tunnel._ctrlHandler.sendData;
    const packets: any[]=[];let sid:number|undefined;
    h.tunnel._onConnectEndPointCallback=(id:number,opt:any)=>{sid=id;open(id,{...opt,port:(endpoint.address() as net.AddressInfo).port,bufferLimit:16*1024*1024});};
    h.tunnel._ctrlHandler.sendData=function(bytes:Buffer,...args:any[]){packets.push(...new CtrlPacketStreamer().readCtrlPacketList(bytes));return send.call(this,bytes,...args);};
    try {
        await wait(()=>SocketHandler.globalMemoryBufferSize===0 && SocketHandler.globalFileCacheSize===0,'Initial accounting did not settle');
        SocketHandler.GlobalMemCacheLimit=65536;
        const client=net.createConnection({host:'127.0.0.1',port:ServerOptionStore.instance.serverOption.tunnelingOptions[1].forwardPort});
        sockets.push(client);client.on('error',error=>{failure=error;});client.on('data',bytes=>responses.push(Buffer.from(bytes)));client.on('end',()=>{ended=true;});client.pause();
        await once(client,'connect');client.write('go');
        await wait(()=>{if(failure)throw failure;return writes>0;},'No actual cache pressure');
        client.resume();
        await wait(()=>{if(failure)throw failure;return ended;},'Cached response did not reach external FIN',10000);
        expect(done).toBe(true);expect(Buffer.concat(responses)).toHaveLength(payload.length);
        expect(createHash('sha256').update(Buffer.concat(responses)).digest('hex')).toBe(expected);
        expect(writes).toBeGreaterThan(0);expect(reads).toBeGreaterThan(0);
        expect(packets.filter(p=>p.sessionID===sid && p.cmd===CtrlCmd.CloseSession)).toHaveLength(1);
        await wait(()=>!h.tunnel._activatedSessionDataHandlerMap.has(sid),'Data handler not cleaned');
        await wait(()=>SocketHandler.globalMemoryBufferSize===0 && SocketHandler.globalFileCacheSize===0,'Accounting did not recover before fixture disposal');
        await h.sibling.roundtrip(h.siblingSession,'healthy-after-drain');
    } finally {
        sockets.forEach(s=>s.destroy());h.tunnel._onConnectEndPointCallback=open;h.tunnel._ctrlHandler.sendData=send;
        await new Promise<void>(r=>endpoint.close(()=>r()));SocketHandler.GlobalMemCacheLimit=prior;
        FileCache.prototype.writeSync=write;FileCache.prototype.readSync=read;
    }
}));

test.each(['end','reset'] as const)('actual endpoint %s reports one terminal state and matching mode', async mode=>{
    const peers:net.Socket[]=[];let accepted:net.Socket|undefined;
    const server=net.createServer(s=>{accepted=s;peers.push(s);s.on('error',()=>{});});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const pool=new EndPointClientPool(), states: number[]=[], terminated:any[]=[];
    pool.onEndPointClientStateChangeCallback=(_id,state)=>{if(state===SocketState.End||state===SocketState.Closed)states.push(state);};
    pool.onEndPointTerminateCallback=(...args:any[])=>terminated.push(args);
    try {
        pool.open(9,{host:'127.0.0.1',port:(server.address() as net.AddressInfo).port,tls:false,bufferLimit:1024});
        await until(()=>!!accepted);
        if(mode==='end')accepted!.end();else accepted!.resetAndDestroy();
        await wait(()=>terminated.length>0,'Endpoint terminal callback absent');
        expect(states).toHaveLength(1);expect(terminated).toEqual([[9,mode==='end'?'graceful':'abort']]);
    } finally {pool.dispose();peers.forEach(s=>s.destroy());await new Promise<void>(r=>server.close(()=>r()));}
});

test('endpoint native EOF during explicit unsatisfied close wait remains abort once', async()=>{
    const peers:net.Socket[]=[]; let accepted:net.Socket|undefined;
    const server=net.createServer(socket=>{accepted=socket;peers.push(socket);socket.on('error',()=>{});});
    const pool:any=new EndPointClientPool(), modes:any[]=[], states:SocketState[]=[];
    pool.onEndPointTerminateCallback=(...args:any[])=>modes.push(args);
    pool.onEndPointClientStateChangeCallback=(_id:number,state:SocketState)=>{
        if(state===SocketState.End||state===SocketState.Closed)states.push(state);
    };
    try {
        server.listen(0,'127.0.0.1');await once(server,'listening');
        pool.open(91,{host:'127.0.0.1',port:(server.address() as net.AddressInfo).port,tls:false,bufferLimit:1024});
        await wait(()=>!!accepted&&pool._endPointClientMap.has(91),'Owned endpoint did not connect');
        const handler=pool._endPointClientMap.get(91);
        expect(pool.close(91,100)).toBe(true);
        expect(handler.closeWait).toBe(true);expect(handler.closeInitiated).toBe(false);
        expect(handler.sendLength).toBe(0);
        accepted!.end();
        await wait(()=>modes.length===1,'Native endpoint EOF did not notify');
        expect(modes).toEqual([[91,'abort']]);expect(states).toHaveLength(1);
        expect(pool._endPointClientMap.has(91)).toBe(false);
    } finally {pool.dispose();peers.forEach(socket=>socket.destroy());await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('already drained graceful data retirement rejects immediate late payload without queuing', async()=>withClient(async h=>{
    const handler=[...h.tunnel._activatedSessionDataHandlerMap.values()][0] as any;
    const sid=handler.sessionID, serverData=h.pool._activatedSessionHandlerMap_.get(sid);
    await wait(()=>handler.isOutputDrained,'Real data output was not initially drained');
    const received:Buffer[]=[], send=handler.sendData;let writes=0;
    const observe=(bytes:Buffer)=>received.push(Buffer.from(bytes));
    serverData.socket.on('data',observe);
    handler.sendData=function(...args:any[]){writes++;return send.apply(this,args);};
    try {
        const before=h.tunnel._waitBufferBytesTotal;
        h.tunnel.terminateEndPointSession(sid,'graceful');
        // No event-loop turn: exercise end_()'s actual already-drained fast path.
        const accepted=h.tunnel.sendData(sid,Buffer.from('forbidden-after-graceful'));
        const queued=h.tunnel._waitBufferBytesTotal;
        await wait(()=>handler.socket.destroyed,'Retiring native data socket did not terminate');
        expect({accepted,writes,queued}).toEqual({accepted:false,writes:0,queued:before});
        expect(Buffer.concat(received)).toHaveLength(0);
        expect(h.tunnel._activatedSessionDataHandlerMap.has(sid)).toBe(false);
        await h.sibling.roundtrip(h.siblingSession,'healthy-after-graceful-rejection');
    } finally {handler.sendData=send;serverData.socket.off('data',observe);}
}));

test('omitted and explicit abort are cleanup-only and never add a peer close notification', async()=>withClient(async h=>{
    const handler=[...h.tunnel._activatedSessionDataHandlerMap.values()][0] as any;
    const control=h.tunnel._ctrlHandler, send=control.sendData;let writes=0;
    control.sendData=function(...args:any[]){writes++;return send.apply(this,args);};
    try {
        h.tunnel.terminateEndPointSession(handler.sessionID);
        h.tunnel.terminateEndPointSession(handler.sessionID,'abort');
        expect(handler.socket.destroyed).toBe(true);expect(h.tunnel._activatedSessionDataHandlerMap.has(handler.sessionID)).toBe(false);
        expect(writes).toBe(0);
    } finally {control.sendData=send;}
}));

test('old endpoint End and posted termination cannot remove a real same-SID replacement',async()=>{
    const peers:net.Socket[]=[];const server=net.createServer(s=>{peers.push(s);s.on('error',()=>{});});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const pool:any=new EndPointClientPool();const opt={host:'127.0.0.1',port:(server.address() as net.AddressInfo).port,tls:false,bufferLimit:1024};
    let connected=0,terminations=0,receives='';
    pool.onEndPointTerminateCallback=()=>terminations++;
    pool.onEndPointClientStateChangeCallback=(_id:number,state:number,bundle:any)=>{
        if(state===SocketState.Connected)connected++;
        if(state===SocketState.End)pool.open(71,opt);
        if(state===SocketState.Receive)receives+=bundle.data.toString();
    };
    try {
        pool.open(71,opt);await wait(()=>peers.length===1&&connected===1,'First endpoint did not connect');
        peers[0].end();await wait(()=>peers.length===2&&connected===2,'Replacement did not actually connect');
        const replacement=pool._endPointClientMap.get(71);
        peers[1].write('fresh-owner');await wait(()=>receives==='fresh-owner','Replacement lost after stale terminal');
        expect(pool._endPointClientMap.get(71)).toBe(replacement);expect(replacement.socket.destroyed).toBe(false);expect(terminations).toBe(0);
    } finally {pool.dispose();peers.forEach(s=>s.destroy());await new Promise<void>(r=>server.close(()=>r()));}
});

test('real pending remote-close drain callback cannot close a replacement with the same SID',async()=>withClient(async h=>{
    const old=[...h.tunnel._activatedSessionDataHandlerMap.values()][0] as any, sid=old.sessionID;
    const serverData=(h.pool as any)._activatedSessionHandlerMap_.get(sid), global=SocketHandler.maxGlobalMemoryBufferSize;
    const originalClose=h.tunnel._onEndPointCloseCallback, make=h.tunnel.makeConnectOpt, controlSend=h.pool._controlHandler.sendData;
    const peers:net.Socket[]=[];const accept=net.createServer(s=>{peers.push(s);s.on('error',()=>{});});
    accept.listen(0,'127.0.0.1');await once(accept,'listening');
    let closed=0,holdFurtherClose=false;
    h.pool._controlHandler.sendData=function(bytes:Buffer,...args:any[]){
        if(holdFurtherClose&&new CtrlPacketStreamer().readCtrlPacketList(bytes)[0]?.cmd===CtrlCmd.CloseSession)return;
        return controlSend.call(this,bytes,...args);
    };
    try {
        SocketHandler.GlobalMemCacheLimit=65536;serverData.socket.pause();old.socket.cork();
        h.tunnel.sendData(sid,Buffer.alloc(8*1024*1024,0x61));
        expect(old.isOutputDrained).toBe(false);
        h.pool._controlHandler.sendData((require('../../../src/commons/CtrlPacket').CtrlPacket).closeSession(old.handlerID,sid,0,{handlerID:old.handlerID}).toBuffer());
        await wait(()=>old._drainEventList.length>0,'Actual control close did not register pending drain');
        holdFurtherClose=true;
        h.tunnel.makeConnectOpt=()=>({host:'127.0.0.1',port:(accept.address() as net.AddressInfo).port,tls:false});
        h.tunnel.connectDataHandler(old.handlerID,sid,old.bindingToken);
        await wait(()=>h.tunnel._activatedSessionDataHandlerMap.get(sid)!==old,'Replacement data socket not connected');
        const replacement=h.tunnel._activatedSessionDataHandlerMap.get(sid), queue=h.tunnel._waitBufferQueueMap.get(sid);
        h.tunnel._onEndPointCloseCallback=(id:number,...args:any[])=>{closed++;return originalClose(id,...args);};
        old.destroy();
        expect(closed).toBe(0);expect(h.tunnel._activatedSessionDataHandlerMap.get(sid)).toBe(replacement);
        expect(h.tunnel._waitBufferQueueMap.get(sid)).toBe(queue);expect(replacement.socket.destroyed).toBe(false);
    } finally {
        h.tunnel._onEndPointCloseCallback=originalClose;h.tunnel.makeConnectOpt=make;h.pool._controlHandler.sendData=controlSend;
        serverData.socket.resume();old.socket.uncork();old.destroy();peers.forEach(s=>s.destroy());await new Promise<void>(r=>accept.close(()=>r()));
        SocketHandler.GlobalMemCacheLimit=global;
    }
}));
