


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
    /** 이슈 368: 요청자를 켠 사람으로 놓고 서버가 계산한 켜 둘 시간 상한(초). 없으면 null. 옛 서버 응답에는 없다. */
    timeoutCapSeconds?: number | null,
    /** 이슈 369: 꺼짐에서 켜짐으로 바뀐 시각(ms). 옛 서버 응답에는 없다(가동 시간 uptime 을 쓴다). */
    activatedAt?: number,
    /** 이슈 369: 이 터널의 연결을 맡을 수 있는 신뢰 클라이언트(표시 이름·연결 여부). 비면 모든 클라이언트다. 옛 서버 응답에는 없다. */
    allowedClients?: Array<{clientId: string; name: string; connected: boolean}>,
    /** 이슈 338: 이 터널을 맡을 수 있는 클라이언트가 연결되어 있는가. 옛 서버 응답에는 없다(연결된 것으로 본다). */
    clientConnected?: boolean,
    /** 이슈 348: 켠 사람의 IP 에서만 연결을 받는가. 옛 서버 응답에는 없다(목록 응답의 값을 쓴다). */
    activatorIpOnly?: boolean,
    /** 이슈 348: 내 허용 IP. 없으면 null 이다. */
    myAllowedIp?: string | null,
    /** 이슈 348: 판정에 쓰이는 허용 IP 항목 수(나를 포함한다). */
    allowedIpCount?: number,
    /** 이슈 348: 모든 사용자의 허용 IP {userId → IP}. 슈퍼유저에게만 온다. */
    allowedIps?: Record<string, string>,
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
    /** 이슈 338: 화면에 보이는 이름(선택, 1~40자). */
    name?: string,
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
    /** 이슈 367: 표시 이름(displayName)은 소유자별 묶음의 머리글에 쓴다. 옛 서버 응답에는 없다. */
    owner?: {id: string; username?: string; displayName?: string};
    /** 서버에 저장된 소유자 id. 목록 응답에만 실리고 저장 본문에서는 뺀다(ServerOptionCtrl.updateTunnelingOption). */
    ownerId?: string;
    /** U3-06: GET 응답. false 면 고칠 수 없다(그룹 공유·공유받은 터널·켜기 전용 그룹). */
    editable?: boolean;
    /** 이슈 347: GET 응답. 켜고 끌 수 있는가. 옛 서버 응답에는 없다(editable 을 따른다). */
    toggleable?: boolean;
    /** 이슈 347: 공유 사용자 id. 고칠 수 있는 사람의 GET 응답에만 있고, 저장 본문에 싣는다. */
    sharedUserIds?: string[];
    /** 이슈 347: 공유 사용자 표현(칩용). GET 응답에만 있고 저장 본문에서는 뺀다. */
    sharedUsers?: Array<{id: string; username: string; displayName: string}>;
    /** U3-06: 일반 유저는 allowedClientNames 대신 이것만 쓴다. */
    allowedClientIds?: Array<string>;
    /** U5-06: 접속 레이트 리밋. 서버가 늘 채워 돌려준다. */
    rateLimit?: RateLimitOption;
    /** 이슈 348: 켠 사람의 IP 에서만 연결을 받는다. 서버는 옛 터널도 값(false)으로 준다. 새 터널은 true 로 만든다. */
    activatorIpOnly?: boolean;
    /** 이슈 348: 허용 IP 목록. 슈퍼유저의 GET 응답에만 있고, 저장 본문에 실려도 서버가 무시한다. */
    activatorIps?: Record<string, string>;
}

export type { ServerOption, Options, HttpOption, CustomHeader, TunnelingStatus, RewriteRule};