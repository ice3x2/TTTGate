import {type CertInfo, InvalidSession} from "./Types";


class CertificationCtrl {

    private static _instance : CertificationCtrl;
    private constructor() {}

    public static get instance () : CertificationCtrl {
        if(!CertificationCtrl._instance) {
            CertificationCtrl._instance = new CertificationCtrl();
        }
        return CertificationCtrl._instance;
    }

    public async updateAdminCert(cert: CertInfo) : Promise<{success: boolean, message: string}>  {
        let res = await fetch("/api/adminCert", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({certInfo: cert})
        });
        if(res.status == 401) {
            throw new InvalidSession();
        }
        return await res.json();
    }

    public async loadAdminCert() : Promise<CertInfo>  {
        let res = await fetch("/api/adminCert", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if(res.status == 401) {
            throw new InvalidSession();
        }
        return json['certInfo'];
    }

    public async loadExternalServerCert(port: number) : Promise<CertInfo> {
        let res = await fetch(`/api/externalCert/${port}`, {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if(res.status == 401) {
            throw new InvalidSession();
        }
        return json['certInfo'];
    }

    public async updateExternalServerCert(port: number, cert: CertInfo) : Promise<{success: boolean, message: string}> {
        let res = await fetch(`/api/externalCert/${port}`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({certInfo: cert})
        });
        if(res.status == 401) {
            throw new InvalidSession();
        }
        return await res.json();
    }

    public async deleteExternalServerCert(port: number) : Promise<{success: boolean, message: string}> {
        let res = await fetch(`/api/externalCert/${port}`, {
            method: "DELETE",
            credentials: "same-origin"
        });
        if(res.status == 401) {
            throw new InvalidSession();
        }
        return await res.json();
    }

}

export default CertificationCtrl;