

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
}


class InvalidSession extends Error {
    constructor() {
        super('Invalid session');
        this.name = 'InvalidSession';
    }
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
    state: 'connecting' | 'connected' | 'end';
    name: string,
    uptime: number;
    address: string;
}



export {type PemData,type ServerOption,type CertInfo,InvalidSession,type SysInfo, type NetworkInfo, type Usage, type NetworkInterface,type ClientStatus}