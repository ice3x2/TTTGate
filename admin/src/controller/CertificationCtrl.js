import { InvalidSession } from "./Types";
class CertificationCtrl {
    static _instance;
    constructor() { }
    static get instance() {
        if (!CertificationCtrl._instance) {
            CertificationCtrl._instance = new CertificationCtrl();
        }
        return CertificationCtrl._instance;
    }
    async updateAdminCert(cert) {
        let res = await fetch("/api/adminCert", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ certInfo: cert })
        });
        if (res.status == 401) {
            throw new InvalidSession();
        }
        return await res.json();
    }
    async loadAdminCert() {
        let res = await fetch("/api/adminCert", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if (res.status == 401) {
            throw new InvalidSession();
        }
        return json['certInfo'];
    }
    async loadExternalServerCert(port) {
        let res = await fetch(`/api/externalCert/${port}`, {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if (res.status == 401) {
            throw new InvalidSession();
        }
        return json['certInfo'];
    }
    async updateExternalServerCert(port, cert) {
        let res = await fetch(`/api/externalCert/${port}`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ certInfo: cert })
        });
        if (res.status == 401) {
            throw new InvalidSession();
        }
        return await res.json();
    }
    async deleteExternalServerCert(port) {
        let res = await fetch(`/api/externalCert/${port}`, {
            method: "DELETE",
            credentials: "same-origin"
        });
        if (res.status == 401) {
            throw new InvalidSession();
        }
        return await res.json();
    }
}
export default CertificationCtrl;
//# sourceMappingURL=CertificationCtrl.js.map