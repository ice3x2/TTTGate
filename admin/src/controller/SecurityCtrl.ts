import {adminRequest} from "./AdminRequest";
import type {ApiResult, BanEntry, BlocklistEntry, CountryEntry, GeoConfig} from "./Types";

// U5-06: 국가 필터와 차단 목록. 슈퍼유저 전용 API 다(섹션 가드가 화면 진입을 막는다).
class SecurityCtrl {
    private static _instance: SecurityCtrl;

    private constructor() {
    }

    public static get instance(): SecurityCtrl {
        if(!SecurityCtrl._instance) {
            SecurityCtrl._instance = new SecurityCtrl();
        }
        return SecurityCtrl._instance;
    }

    public getGeo(): Promise<ApiResult<{geo: GeoConfig}>> {
        return adminRequest("/api/security/geo");
    }

    public putGeo(geo: GeoConfig): Promise<ApiResult<{geo: GeoConfig; warnings: string[]}>> {
        return adminRequest("/api/security/geo", {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify(geo)});
    }

    public countries(): Promise<ApiResult<{countries: CountryEntry[]}>> {
        return adminRequest("/api/security/countries");
    }

    public bans(): Promise<ApiResult<{serverTime: number; bans: BanEntry[]}>> {
        return adminRequest("/api/security/bans");
    }

    public unban(port: number, ip: string): Promise<ApiResult<{removed: boolean}>> {
        return adminRequest(`/api/security/bans/${port}/${encodeURIComponent(ip)}`, {method: "DELETE"});
    }

    // #286 관리자 차단 목록.
    public blocklist(): Promise<ApiResult<{entries: BlocklistEntry[]; limit: number}>> {
        return adminRequest("/api/security/blocklist");
    }

    /** fromBan 을 주면 그 일시 차단을 함께 푼다. */
    public block(request: {address: string; port?: number | null; note?: string; fromBan?: {port: number; ip: string}}):
        Promise<ApiResult<{entry: BlocklistEntry; unbanned: boolean}>> {
        return adminRequest("/api/security/blocklist", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(request)});
    }

    public unblock(address: string): Promise<ApiResult<{removed: boolean}>> {
        return adminRequest(`/api/security/blocklist/${encodeURIComponent(address)}`, {method: "DELETE"});
    }
}

export default SecurityCtrl;
