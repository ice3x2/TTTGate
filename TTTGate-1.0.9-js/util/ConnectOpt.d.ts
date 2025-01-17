type ConnectOpt = {
    host: string;
    port: number;
    tls?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
    keepalive?: number;
};
export default ConnectOpt;
