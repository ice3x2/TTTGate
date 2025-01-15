



type Protocol =  "tcp" | "http" | "https";
type CustomHeader = {
    name: string;
    value: string;
    replace?: boolean;
}

type RewriteRule = {
    from: string;
    to: string;
    //regex: boolean;
}

type HttpOption = {
    rewriteHostInTextBody?: boolean;
    customRequestHeaders?: Array<CustomHeader>;
    customResponseHeaders?: Array<CustomHeader>;
    bodyRewriteRules?: Array<RewriteRule>;
    replaceAccessControlAllowOrigin?: boolean;

}


type TunnelingStatus = {
    port: number,
    online: boolean,
    sessions: number
    uptime: number,
    active: boolean,
    activeStart: number,
    activeTimeout: number,
    rx: number,
    tx: number,
}


type ServerOption = {
    key: string,
    adminPort?: number,
    port: number,
    tls : boolean,
    tunnelingOptions: Array<Options>
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

type Options = {
    forwardPort: number,
    protocol?: Protocol,
    httpOption: HttpOption,
    destinationAddress: string,
    destinationPort?: number;
    tls?: boolean;
    inactiveOnStartup?: boolean;
    allowedClientNames?: Array<string>;
    bufferLimitOnServer?: number,
    bufferLimitOnClient?: number
    security? : SecurityOption
}

export type { ServerOption, Options, HttpOption, CustomHeader, TunnelingStatus, RewriteRule, SecurityOption};