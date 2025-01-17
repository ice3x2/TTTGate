interface PemData {
    name: string;
    value: string;
}
type CertInfo = {
    cert: PemData;
    key: PemData;
    ca: PemData;
};
type ExternalCertFileInfo = {
    [port: number]: CertInfo;
};
declare class CertificationStore {
    private static _instance;
    private _externalCert;
    private _adminCert;
    private _tempCert;
    private _adminCertFile;
    private _externalCertFile;
    private static makeEmptyCertFileInfo;
    private constructor();
    static get instance(): CertificationStore;
    makeTempCert(): Promise<{
        cert: {
            name: string;
            value: string;
        };
        key: {
            name: string;
            value: string;
        };
        ca: {
            name: string;
            value: string;
        };
    }>;
    getTempCert(): CertInfo;
    reset(): Promise<void>;
    load(): Promise<void>;
    getAdminCert(): CertInfo;
    getExternalCert(port: number): CertInfo;
    getAllExternalCert(): ExternalCertFileInfo;
    private save;
    private writeCertFile;
    private removeCertFile;
    updateAdminServerCert(certInfo: CertInfo): Promise<boolean>;
    updateExternalServerCert(port: number, certInfo: CertInfo): Promise<boolean>;
    removeForExternalServer(port: number): Promise<void>;
    removeForAdminServer(): Promise<void>;
    saveForExternalServer(port: number, certInfo: CertInfo): Promise<boolean>;
    loadExternalCert(): Promise<void>;
    loadAdminCert(): Promise<void>;
    private checkKeyPair;
    private validateKeyPair;
    private static isValidPrivateKey;
    private static isValidCertificate;
}
export { CertificationStore, CertInfo, PemData };
