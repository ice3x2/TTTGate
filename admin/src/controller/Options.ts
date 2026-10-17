


// noinspection DuplicatedCode
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
    keepAlive: number
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
    keepAlive?: number
    /** U3-06: GET 응답의 소유자. system:migrated 에는 username 이 없다. */
    owner?: {id: string; username?: string};
    /** U3-06: GET 응답. false 면 읽기 전용(그룹 공유)이다. */
    editable?: boolean;
    /** U3-06: 일반 유저는 allowedClientNames 대신 이것만 쓴다. */
    allowedClientIds?: Array<string>;
}

export type { ServerOption, Options, HttpOption, CustomHeader, TunnelingStatus, RewriteRule};