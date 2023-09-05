


// noinspection DuplicatedCode
type Protocol =  "tcp" | "http" | "https";
type CustomHeader = {
    name: string;
    value: string;
    replace?: boolean;
}

type HostRewriteRule = {
    from: string;
    to: string;
}

type HttpOption = {
    rewriteHostInTextBody?: boolean;
    customRequestHeaders?: Array<CustomHeader>;
    customResponseHeaders?: Array<CustomHeader>;
    bodyRewriteRules?: Array<HostRewriteRule>;
    replaceAccessControlAllowOrigin?: boolean;

}


type ExternalServerStatus = {
    port: number,
    online: boolean,
    sessions: number
    uptime: number,
    rx: number,
    tx: number,
}


type ServerOption = {
    key: string,
    adminPort?: number,
    port: number,
    tls : boolean,
    tunnelingOptions: Array<TunnelingOption>
}

type TunnelingOption = {
    forwardPort: number,
    protocol?: Protocol,
    httpOption?: HttpOption,
    destinationAddress: string,
    destinationPort?: number;
    tls?: boolean;
}

export type { ServerOption, TunnelingOption, HttpOption, CustomHeader, ExternalServerStatus };