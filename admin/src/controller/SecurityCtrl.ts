import {adminRequest} from "./AdminRequest";
import type {ApiResult, BanEntry, CountryEntry, GeoConfig} from "./Types";

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
}

export default SecurityCtrl;
