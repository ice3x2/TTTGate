


// noinspection DuplicatedCode
import type {RateLimitOption} from "./Types";
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
    /** U5-06: 거절 건수와 차단된 IP 수. */
    rejected?: {geo: number; rateLimit: number},
    bannedIps?: number,
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
    /** TLS 터널에서 대상 서버의 자체 서명 인증서를 허용한다(인증서 검증을 건너뛴다). */
    allowSelfSignedDestinationCert?: boolean;
    inactiveOnStartup?: boolean;
    allowedClientNames?: Array<string>;
    bufferLimitOnServer?: number,
    bufferLimitOnClient?: number
    keepAlive?: number
    /** U3-06: GET 응답의 소유자. system:migrated 에는 username 이 없다. */
    owner?: {id: string; username?: string};
    /** 서버에 저장된 소유자 id. 목록 응답에만 실리고 저장 본문에서는 뺀다(ServerOptionCtrl.updateTunnelingOption). */
    ownerId?: string;
    /** U3-06: GET 응답. false 면 읽기 전용(그룹 공유)이다. */
    editable?: boolean;
    /** U3-06: 일반 유저는 allowedClientNames 대신 이것만 쓴다. */
    allowedClientIds?: Array<string>;
    /** U5-06: 접속 레이트 리밋. 서버가 늘 채워 돌려준다. */
    rateLimit?: RateLimitOption;
}

export type { ServerOption, Options, HttpOption, CustomHeader, TunnelingStatus, RewriteRule};