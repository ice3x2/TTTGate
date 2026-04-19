import ClientApp from "./client/ClientApp";
import ServerApp from "./server/ServerApp";
import Environment from "./Environment";
import Sentinel from "./Sentinel";
import AppCompositionRoot from "./bootstrap/AppCompositionRoot";
import CLI from "./util/CLI";

AppCompositionRoot.configureLogger();



let app = () => {
    console.log('TTTGate v' + Environment.version.name + ' (' + Environment.version.build + ')');
    let sentinel : Sentinel = Sentinel.create(Environment.devMode);
    let parsedCli = CLI.parseCommandLine();
    let startType = parsedCli.mode;

    if(startType == 'stop') {
        console.log('Stop TTTGate processes ...')
        Sentinel.stop();
        return;
    }
    else if(Sentinel.isSentinelMode() || (!Sentinel.hasExecuteMode() && Sentinel.isDaemonMode())) {
        sentinel.start();
        return;
    }
    else if(startType == 'server' && !sentinel.start()) {
        AppCompositionRoot.useServerCacheDir();
        ServerApp.start(parsedCli.options).then(() => {
            console.log('server started');
        }).catch((err) => {
            console.error(err);
        });
    }
    else if(startType == 'client' && !sentinel.start()) {
        AppCompositionRoot.useClientCacheDir();
        ClientApp.start(parsedCli.options);
    }
    else if(!Sentinel.isDaemonMode() && !Sentinel.hasExecuteMode()) {
        console.log('Usage: TTTGate [server|client] [options]');
        console.log('');
        console.log('    server: start server');
        console.log('       -adminPort [port]  : Admin server port');
        console.log('       -keepAlive [ms]    : Control listener TCP keepalive interval');
        console.log('       -allowLegacyAdminHttp   : Allow legacy admin HTTP for one process run');
        console.log('       -allowLegacyAdminRemote : Allow legacy non-loopback admin bind for one process run');
        console.log('       -allowLegacyControlAuth : Allow legacy shared-key control authentication');
        console.log('       -reset [true|false]: Reset persisted server state');
        console.log('       -daemon            : Background execution and process monitoring.');
        console.log('');
        console.log('    client: start client');
        console.log('       -addr [host:port]  : server address. (ex: host.com:1234)');
        console.log('                           The port number is optional.         ');
        console.log('       -tls               : use tls');
        console.log('       -name [name]       : client name');
        console.log('       -clientId [id]     : authenticated client identifier for protocol v2');
        console.log('       -clientSecret [s]  : protocol v2 shared secret');
        console.log('       -displayName [n]   : display-only client name for protocol v2');
        console.log('       -key  [key]        : legacy shared key (legacy control auth only)');
        console.log('       -ca [pem]          : trusted CA/server certificate PEM');
        console.log('       -serverName [name] : expected TLS server name');
        console.log('       -allowLegacyFallback : allow legacy v1 fallback during rollback');
        console.log('       -allowInsecureTls    : disable TLS certificate verification');
        console.log('       -keepAlive [ms]    : Control connection TCP keepalive interval');
        console.log('       -bufferLimit [MiB] : Buffer limit size on memory.');
        console.log('       -save              : Save options to file');
        console.log('       -daemon            : Background execution and process monitoring.');
        console.log('');
        console.log('    stop: stop server or client');


    }
}



app();
