

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


interface SysStatus {
    cpuInfo : {
        model: string;
        speed: number;
        cores: number;
        usage: number;
    },
    osInfo: {
        platform: string;
        release: string;
        type: string;
        hostname: string;
    },
    cpu: {
        total: number;
        process: number;
    },
    uptime: number;
    heap: {
        used: number;
        total: number;
    };
    memory: {
        free: number;
        total: number;
        process: number;
    };
    totalBuffer: {
        used: number;
        total: number;
    };
}

interface ClientStatus {
    id: number;
    state: 'connecting' | 'connected' | 'end';
    name: string,
    uptime: number;
    address: string;
}



export {type PemData,type ServerOption,type CertInfo,InvalidSession,type SysStatus,type ClientStatus}