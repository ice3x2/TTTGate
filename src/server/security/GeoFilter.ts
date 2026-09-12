import {ADMIT, AdmissionDecision, AdmissionScope} from "./AdmissionPolicy";
import {isPrivateAddress} from "./address";
import {GeoConfig} from "../../types/TunnelingOption";

type GeoipLookup = {country?: string};
type GeoipModule = {lookup(ip: string): GeoipLookup | null};

const GEO_DENY: AdmissionDecision = Object.freeze({allowed: false, reason: 'geo-deny'});

// U5-03 / #118 — geoip-lite 조회와 허용·차단 판정. mode가 off가 아닐 때만 지연 로드한다(파일 최상단 import 금지).
export class GeoFilter {
    private _config: GeoConfig = {mode: 'off', countries: [], applyToAdmin: true, unknownPolicy: 'allow'};
    private _countrySet: ReadonlySet<string> = new Set();
    private _geoip: GeoipModule | undefined;
    private _rejected = 0;
    private _lookups = 0;

    public configure(config: GeoConfig): void {
        this._config = config;
        this._countrySet = new Set(config.countries);
        if(config.mode !== 'off' && !this._geoip) {
            this._geoip = require('geoip-lite') as GeoipModule;
        }
    }

    public isDatabaseLoaded(): boolean {
        return this._geoip !== undefined;
    }

    public lookupCountry(ip: string): string | undefined {
        if(isPrivateAddress(ip)) return undefined;
        if(!this._geoip) return undefined;
        this._lookups++;
        return this._geoip.lookup(ip)?.country;
    }

    public decide(ip: string, scope: AdmissionScope): AdmissionDecision {
        if(this._config.mode === 'off') return ADMIT;
        if(scope.kind === 'admin' && !this._config.applyToAdmin) return ADMIT;

        const country = this.lookupCountry(ip);
        if(country === undefined) {
            if(this._config.unknownPolicy === 'allow') return ADMIT;
            this._rejected++;
            return GEO_DENY;
        }

        const inList = this._countrySet.has(country);
        const allowed = this._config.mode === 'allow' ? inList : !inList;
        if(allowed) return ADMIT;
        this._rejected++;
        return GEO_DENY;
    }

    public stats(): {rejected: number; lookups: number} {
        return {rejected: this._rejected, lookups: this._lookups};
    }
}
