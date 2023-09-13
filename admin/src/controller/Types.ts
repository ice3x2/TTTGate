

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




export {type PemData,type ServerOption,type CertInfo,InvalidSession}