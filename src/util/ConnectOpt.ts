

type ConnectOpt = {
    host : string;
    port : number;
    tls? : boolean;
    ca? : string;
    cert? : string;
    key? : string;
    serverName?: string;
    rejectUnauthorized?: boolean;
    keepalive? : number
    timeout? : number;
}

export default ConnectOpt;
