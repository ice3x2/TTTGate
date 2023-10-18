import ClientApp from "./client/ClientApp";
import ServerApp from "./server/ServerApp";
import Environment from "./Environment";
import {SocketHandler} from "./util/SocketHandler";
import Sentinel from "./Sentinel";

let sentinel : Sentinel = Sentinel.create(Environment.devMode);



let _findTypeByArgv = () : 'server' | 'client' | 'none' | 'stop' => {
    let items : Array<string> = process.argv;
    for(let item of items) {
        if(item.startsWith("-")) {
            return 'none';
        }
        else if(item == 'server')
            return 'server';
        else if(item == 'stop')
            return 'stop';
        else if(item == 'client')
            return 'client';
    }
    return 'none';
}



let startType =  _findTypeByArgv();
if(startType == 'server' && !sentinel.start()) {
    SocketHandler.fileCacheDirPath = Environment.path.serverCacheDir;
    ServerApp.start().then(() => {
        console.log('server started');
    }).catch((err) => {
        console.error(err);
    });
}
else if(startType == 'client' && !sentinel.start()) {
    SocketHandler.fileCacheDirPath = Environment.path.clientCacheDir;
    ClientApp.start();
}
else if(startType == 'stop') {
    Sentinel.stop();
}
else if(!Sentinel.isDaemonMode() && !Sentinel.hasExecuteMode()) {
    console.log('Usage: TTTGate [server|client] [options]');
    console.log('');
    console.log('    server: start server');
    console.log('       -adminPort [port]  : Admin server port');
    console.log('       -reset             : Reset server options');
    console.log('       -daemon            : Background execution and process monitoring.');
    console.log('');
    console.log('    client: start client');
    console.log('       -addr [host:port]  : server address. (ex: host.com:1234)');
    console.log('                           The port number is optional.         ');
    console.log('       -tls               : use tls');
    console.log('       -name [name]       : client name');
    console.log('       -key  [key]        : authentication key');
    console.log('       -bufferLimit [MiB] : Buffer limit size on memory.');
    console.log('       -save              : Save options to file');
    console.log('       -daemon            : Background execution and process monitoring.');
    console.log('');
    console.log('    stop: stop server or client');


}


