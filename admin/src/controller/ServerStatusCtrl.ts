import {type ApiResult, type ClientStatus, type SysInfo, type Usage, type VersionInfo} from "./Types";
import InvalidSession from "./InvalidSession";
import {adminRequest} from "./AdminRequest";

/** 시스템 정보 요청의 결과. 서버가 거절하거나 서버에 닿지 못하면 실패 값이다. 세션이 끝났으면 InvalidSession 을 던진다. */
export type SysInfoResult = ApiResult<{sysInfo: SysInfo}>;


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
        return json.sysUsage;

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

    public async getSysInfo() : Promise<SysInfoResult> {
        if(this._sysInfoCache) {
            return {success: true, sysInfo: this._sysInfoCache};
        }
        const result: SysInfoResult = await adminRequest("/api/sysInfo");
        if(result.success) this._sysInfoCache = result.sysInfo;
        return result;
    }

    public async getClientSysInfo(id: number) : Promise<SysInfoResult> {
        const sysInfo = this._clientSysInfoCache.get(id);
        if(sysInfo) {
            return {success: true, sysInfo};
        }
        const result: SysInfoResult = await adminRequest(`/api/clientSysInfo/${id}`);
        if(result.success) this._clientSysInfoCache.set(id, result.sysInfo);
        return result;
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
        return json.statuses;
    }

}

export default ServerStatusCtrl;