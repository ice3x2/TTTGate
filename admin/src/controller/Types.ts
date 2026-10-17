

type PemData = {
    name: string;
    value: string;
}

type CertInfo = {
    key: PemData;
    cert: PemData;
    ca: PemData;
}

type ServerOption = {
    key: string;
    adminPort: number;
    adminTls: boolean;
    port: number;
    tls: boolean;
    globalMemCacheLimit: number;
    keepAlive: number;
}

type VersionInfo = {
    name: string;
    build: string;
}





interface NetworkInterface {
    address: string;
    netmask: string;
    family: string;
    mac: string;
    internal: boolean;
    cidr: string;
}

interface NetworkInfo {
    [name: string] : Array<NetworkInterface>;
}

interface Usage {
    memory: {
        free: number;
        total: number;
        process: number;
    },
    cpu: {
        total: number
        process: number;
    };
    uptime: number;
    heap: {
        used: number;
        total: number;
    };
    totalBuffer: {
        used: number;
        total: number;
    };
}

interface SysInfo {
    osInfo: {
        platform: string;
        release: string;
        type: string;
        hostname: string;
    },
    cpuInfo : {
        model: string;
        speed: number;
        cores: number;
    },
    ram: number,
    network : NetworkInfo;
}
interface ClientStatus {
    id: number;
    name: string,
    uptime: number;
    address: string;
    activeSessionCount: number;
}



export {type PemData,type ServerOption,type CertInfo,type SysInfo, type NetworkInfo, type Usage, type NetworkInterface,type ClientStatus, type VersionInfo}

// ---- U3-01: RBAC 화면이 쓰는 서버 응답 형태(단위 2 §3·§5.2). ----
export type Role = 'superuser' | 'regular';
export type UserStatus = 'active' | 'disabled';
export type UserView = {id: string; username: string; displayName: string; role: Role; status: UserStatus;
    groupId: string; groupName: string; mustChangePassword: boolean; migratedFromLegacyAdmin: boolean;
    createdAt: number; updatedAt: number;
    /** U4-04 가 더한 필드. */
    mfaEnabled?: boolean};
export type TunnelProtocolName = 'TCP' | 'HTTP' | 'HTTPS' | 'HTTP_REWRITE';
export type GroupAttributes = {
    tunnel_crud: 'none' | 'read_only' | 'full';
    max_tunnel_count: number;
    max_tunnel_duration_ms: number;
    allowed_port_range: Array<{from: number; to: number}>;
    allowed_protocols: TunnelProtocolName[];
    max_concurrent_connections: number;
    allowed_trusted_clients: string[];
    http_tunnel_rewrite_permissions: {cors: boolean; host: boolean; header: boolean; body: boolean};
    admin_ui_section_access: Array<'tunnels' | 'my_audit' | 'my_profile' | 'my_sessions'>;
    tunnel_visibility: 'private' | 'group_read';
    rate_limit: 'unlimited' | '1MB/s' | '10MB/s' | '100MB/s';
};
export type Group = {id: string; name: string; system: boolean; attributes: GroupAttributes};
export type MeResponse = {user: UserView; group: {id: string; name: string; attributes: GroupAttributes};
    sections: string[]; migrationBanner: boolean};
export type ApiFailure = {success: false; status: number; message: string; code?: string};
export type ApiResult<T> = ({success: true} & T) | ApiFailure;
