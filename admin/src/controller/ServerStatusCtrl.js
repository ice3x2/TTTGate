import { InvalidSession } from "./Types";
class ServerStatusCtrl {
    static _instance;
    _sysInfoCache = null;
    constructor() {
    }
    static get instance() {
        if (!ServerStatusCtrl._instance) {
            ServerStatusCtrl._instance = new ServerStatusCtrl();
        }
        return ServerStatusCtrl._instance;
    }
    async getSysUsage() {
        let res = await fetch("/api/sysUsage", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if (!json || res.status == 401) {
            throw new InvalidSession();
        }
        this._sysInfoCache = json.system;
        return json;
    }
    async getSysInfo() {
        if (this._sysInfoCache) {
            return this._sysInfoCache;
        }
        let res = await fetch("/api/sysInfo", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if (!json || res.status == 401) {
            throw new InvalidSession();
        }
        this._sysInfoCache = json.system;
        return json;
    }
    async getClientStatus() {
        let res = await fetch("/api/clientStatus", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if (!json || res.status == 401) {
            throw new InvalidSession();
        }
        this._sysInfoCache = json.system;
        return json;
    }
}
export default ServerStatusCtrl;
//# sourceMappingURL=ServerStatusCtrl.js.map