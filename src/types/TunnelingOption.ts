


type Protocol = "tcp" | "http" | "https";
type ControlProtocolMode = "legacy" | "mixed" | "mtls-strict";
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
    keepAliveTimeout?: number;
}


type ClientOption = {
    key : string,
    host : string,
    port : number,
    tls : boolean,
    name : string,
    clientId?: string,
    clientSecret?: string,
    displayName?: string,
    ca?: string,
    cert?: string,
    privateKey?: string,
    serverName?: string,
    allowLegacyFallback?: boolean,
    allowInsecureTls?: boolean,
    globalMemCacheLimit: number,
    keepAlive: number
}

type TrustedClient = {
    clientId: string;
    clientSecret: string;
    displayName?: string;
}

type ServerOption = {
    key: string,
    adminPort?: number,
    adminBindHost?: string,
    adminTls?: boolean,
    port: number,
    tls : boolean,
    controlProtocolMode?: ControlProtocolMode,
    allowLegacyControlAuth?: boolean,
    trustedClients?: Array<TrustedClient>,
    tunnelingOptions: Array<TunnelingOption>,
    globalMemCacheLimit?: number
    keepAlive: number


}


type TunnelingOption = {
    forwardPort: number,
    protocol?: Protocol,
    httpOption?: HttpOption,
    destinationAddress: string,
    destinationPort?: number;
    allowedClientNames?: Array<string>;
    allowedClientIds?: Array<string>;
    inactiveOnStartup?: boolean;
    tls?: boolean,
    bufferLimitOnServer?: number,
    bufferLimitOnClient?: number,
    keepAlive: number
}

const DEFAULT_KEY = "hello-TTTGate";

export { ControlProtocolMode, ServerOption, TunnelingOption, ClientOption, HttpOption, CustomHeader, TrustedClient, DEFAULT_KEY};
