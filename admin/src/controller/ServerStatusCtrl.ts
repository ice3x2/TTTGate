import {type ClientStatus, type SysInfo, type Usage, type VersionInfo} from "./Types";
import InvalidSession from "./InvalidSession";


class ServerStatusCtrl {

    private static _instance : ServerStatusCtrl;
    private _sysInfoCache : SysInfo | null = null;
    private _clientSysInfoCache : Map<number, SysInfo> = new Map<number, SysInfo>();
    private static _versionInfo : VersionInfo | null = null;

    private constructor() {

    }



    public static get instance() : ServerStatusCtrl {
        if(!ServerStatusCtrl._instance) {
            ServerStatusCtrl._instance = new ServerStatusCtrl();
        }
        return ServerStatusCtrl._instance;
    }




    public async getSysUsage() : Promise<Usage> {
        let res = await fetch("/api/sysUsage", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        this._sysInfoCache = json.system;
        return json;

    }


    public static async getVersion() : Promise<VersionInfo> {

        if(this._versionInfo) {
            return this._versionInfo;
        }
        let res = await fetch("/api/version", {
            method: "GET",
            credentials: "same-origin"
        });
        return await res.json();
    }

    public async getSysInfo() : Promise<SysInfo> {
        if(this._sysInfoCache) {
            return this._sysInfoCache;
        }
        let res = await fetch("/api/sysInfo", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        this._sysInfoCache = json.system;
        return json;
    }

    public async getClientSysInfo(id: number) : Promise<SysInfo> {
        let sysInfo = this._clientSysInfoCache.get(id);
        if(sysInfo) {
            return sysInfo;
        }
        let res = await fetch(`/api/clientSysInfo/${id}`, {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();

        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        if(!json.success) {
            throw new Error(json.message);
        }

        sysInfo = json as SysInfo;

        this._clientSysInfoCache.set(id, sysInfo);
        return json;
    }


    public async getClientStatus() : Promise<Array<ClientStatus>> {
        let res = await fetch("/api/clientStatus", {
            method: "GET",
            credentials: "same-origin"
        });
        let json = await res.json();
        if(!json || res.status == 401) {
            throw new InvalidSession();
        }
        this._sysInfoCache = json.system;
        return json;
    }

}

export default ServerStatusCtrl;