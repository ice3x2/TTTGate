import ClientApp from "./client/ClientApp";
import ServerApp from "./server/ServerApp";
import SocketHandler from "./util/SocketHandler";
import {FileCache} from "./util/FileCache";
import Path from "path";
import Environment from "./Environment";

SocketHandler.fileCache = FileCache.create(Path.join(Environment.path.cacheDir,new Date().getDate() + '' + Math.random() + '.tmp'));



let _findTypeByArgv = () : 'server' | 'client' | 'none' => {
    let items : Array<string> = process.argv;
    for(let item of items) {
        if(item.startsWith("-")) {
            return 'none';
        }
        else if(item == 'server')
            return 'server';
        else if(item == 'client')
            return 'client';
    }
    return 'none';
}

let startType =  _findTypeByArgv();
if(startType == 'server') {
    ServerApp.start().then(() => {
        console.log('server started');
    }).catch((err) => {
        console.error(err);
    });
}
else if(startType == 'client') {
    ClientApp.start();
}
else {
    console.log('Usage: TTTGate [server|client] [options]');
    console.log('');
    console.log('    server: start server');
    console.log('       -adminPort [port] : Admin server port');
    console.log('       -reset            : Reset server options');
    console.log('');
    console.log('    client: start client');
    console.log('       -addr [host:port] : server address. (ex: host.com:1234)');
    console.log('                           The port number is optional.         ');
    console.log('       -tls              : use tls');
    console.log('       -name [name]      : client name');
    console.log('       -key  [key]       : authentication key');
    console.log('       -save             : Save options to file');
    console.log('');

}


