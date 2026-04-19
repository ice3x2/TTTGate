import net from "net";
import * as tls from "tls";
import ConnectOpt from "./ConnectOpt";

type ServerTlsConfig = {
    port: number;
    tls?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
    keepAlive?: number;
}

type TlsOptionsFactory = {
    createClientSocketOptions(options: ConnectOpt): net.NetConnectOpts | tls.ConnectionOptions;
    createServerTlsOptions(options: ServerTlsConfig): tls.TlsOptions;
}

const MIN_KEEP_ALIVE = 500;

const DefaultTlsOptionsFactory: TlsOptionsFactory = {
    createClientSocketOptions(options: ConnectOpt): net.NetConnectOpts | tls.ConnectionOptions {
        const socketOptions: any = {
            port: options.port,
            host: options.host,
            allowHalfOpen: false,
            keepAlive: (options.keepalive ?? 60000) > 0,
            keepAliveInitialDelay: Math.max(options.keepalive ?? 60000, MIN_KEEP_ALIVE),
            noDelay: true,
            rejectUnauthorized: options.rejectUnauthorized !== false
        };

        if(options.ca) {
            socketOptions.ca = options.ca;
        }
        if(options.cert) {
            socketOptions.cert = options.cert;
        }
        if(options.key) {
            socketOptions.key = options.key;
        }
        if(options.serverName) {
            socketOptions.servername = options.serverName;
        }

        return socketOptions;
    },
    createServerTlsOptions(options: ServerTlsConfig): tls.TlsOptions {
        const tlsOptions: tls.TlsOptions = {
            key: options.key,
            cert: options.cert,
            secureProtocol: "TLSv1_2_server_method"
        };

        if(options.ca) {
            tlsOptions.ca = options.ca;
        }

        return tlsOptions;
    }
};

let activeTlsOptionsFactory: TlsOptionsFactory = DefaultTlsOptionsFactory;

const TlsOptionsFactoryRegistry = {
    current(): TlsOptionsFactory {
        return activeTlsOptionsFactory;
    },
    configure(factory: TlsOptionsFactory): void {
        activeTlsOptionsFactory = factory;
    },
    reset(): void {
        activeTlsOptionsFactory = DefaultTlsOptionsFactory;
    }
};

export { DefaultTlsOptionsFactory, ServerTlsConfig, TlsOptionsFactory, TlsOptionsFactoryRegistry };
