


type Protocol = "tcp" | "http" | "https";
type CustomHeader = {
    name: string;
    value: string;
    replace: boolean;
}

type RewriteRule = {
    from: string;
    to: string;
}

type HttpOption = {
    rewriteHostInTextBody?: boolean;
    customRequestHeaders?: Array<CustomHeader>;
    customResponseHeaders?: Array<CustomHeader>;
    bodyRewriteRules?: Array<RewriteRule>;
    replaceAccessControlAllowOrigin?: boolean;
}


type ClientOption = {
    key : string,
    host : string,
    port : number,
    tls : boolean,
    name : string
    globalMemCacheLimit: number,
    keepAlive: number
}


type ServerOption = {
    key: string,
    adminPort?: number,
    adminTls?: boolean,
    port: number,
    tls : boolean,
    tunnelingOptions: Array<TunnelingOption>,
    globalMemCacheLimit?: number
    keepAlive: number


}

type SecurityOption = {
    blockCountries: Array<string>
    allowCountries: Array<string>
    blockIPs: Array<string>
    allowIPs: Array<string>
    enabledAutoBlock: boolean
    autoBlockThresholdMilliSeconds: number
    autoBlockThresholdCount: number
}


type TunnelingOption = {
    forwardPort: number,
    protocol?: Protocol,
    httpOption?: HttpOption,
    destinationAddress: string,
    destinationPort?: number;
    allowedClientNames?: Array<string>;
    inactiveOnStartup?: boolean;
    tls?: boolean,
    bufferLimitOnServer?: number,
    bufferLimitOnClient?: number,
    security? : SecurityOption,
    keepAlive: number
}

const DEFAULT_KEY = "hello-TTTGate";

export { ServerOption, TunnelingOption, ClientOption, HttpOption, CustomHeader,SecurityOption, DEFAULT_KEY};