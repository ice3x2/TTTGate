


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
}


type ServerOption = {
    key: string,
    adminPort?: number,
    adminTls?: boolean,
    port: number,
    tls : boolean,
    tunnelingOptions: Array<TunnelingOption>,
    globalMemCacheLimit?: number


}

type CacheOption = {
    fileCache: boolean;
    maxMemCacheSize: number;
    enable : boolean;
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
    cacheOption?: CacheOption
}

const DEFAULT_KEY = "hello-TTTGate";

export { ServerOption, TunnelingOption, ClientOption, HttpOption, CustomHeader, DEFAULT_KEY};