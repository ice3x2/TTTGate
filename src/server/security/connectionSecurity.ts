import {ConnectionSecurityOption, DEFAULT_GEO_CONFIG, GeoConfig, GeoMode} from "../../types/TunnelingOption";
import {ISO_ALPHA2} from "./countries";

const GEO_MODES: ReadonlyArray<GeoMode> = ['off', 'allow', 'deny'];

type NormalizeResult =
    {success: true; value: ConnectionSecurityOption; warnings: string[]} |
    {success: false; message: string};

// U5-03 / #118 — server.yaml 및 /api/serverOption 저장 경로 공용 connectionSecurity 검증.
export function normalizeConnectionSecurity(input: unknown): NormalizeResult {
    if(input === undefined) {
        return {success: true, value: {geo: {...DEFAULT_GEO_CONFIG}}, warnings: []};
    }
    if(typeof input !== 'object' || input === null || Array.isArray(input)) {
        return {success: false, message: 'connectionSecurity must be an object'};
    }

    const source = input as Record<string, unknown>;
    if(source.geo === undefined) {
        return {success: true, value: {geo: {...DEFAULT_GEO_CONFIG}}, warnings: []};
    }
    if(typeof source.geo !== 'object' || source.geo === null || Array.isArray(source.geo)) {
        return {success: false, message: 'connectionSecurity.geo must be an object'};
    }
    const geoSource = source.geo as Record<string, unknown>;

    let mode: GeoMode = DEFAULT_GEO_CONFIG.mode;
    if(geoSource.mode !== undefined) {
        if(typeof geoSource.mode !== 'string' || !GEO_MODES.includes(geoSource.mode as GeoMode)) {
            return {success: false, message: `connectionSecurity.geo.mode must be one of ${GEO_MODES.join(', ')}`};
        }
        mode = geoSource.mode as GeoMode;
    }

    let countries: string[] = [];
    if(geoSource.countries !== undefined) {
        if(!Array.isArray(geoSource.countries)) {
            return {success: false, message: 'connectionSecurity.geo.countries must be an array'};
        }
        const normalized: string[] = [];
        for(let i = 0; i < geoSource.countries.length; i++) {
            const raw = geoSource.countries[i];
            if(typeof raw !== 'string') {
                return {success: false, message: `connectionSecurity.geo.countries[${i}] must be a string`};
            }
            const code = raw.trim().toUpperCase();
            if(!ISO_ALPHA2.has(code)) {
                return {success: false, message: `connectionSecurity.geo.countries[${i}] is not an ISO 3166-1 alpha-2 code: ${raw}`};
            }
            if(!normalized.includes(code)) normalized.push(code);
        }
        countries = normalized;
    }

    let applyToAdmin = DEFAULT_GEO_CONFIG.applyToAdmin;
    if(geoSource.applyToAdmin !== undefined) {
        if(typeof geoSource.applyToAdmin !== 'boolean') {
            return {success: false, message: 'connectionSecurity.geo.applyToAdmin must be boolean'};
        }
        applyToAdmin = geoSource.applyToAdmin;
    }

    let unknownPolicy: 'allow' | 'deny' = DEFAULT_GEO_CONFIG.unknownPolicy;
    if(geoSource.unknownPolicy !== undefined) {
        if(geoSource.unknownPolicy !== 'allow' && geoSource.unknownPolicy !== 'deny') {
            return {success: false, message: 'connectionSecurity.geo.unknownPolicy must be allow or deny'};
        }
        unknownPolicy = geoSource.unknownPolicy;
    }

    if(mode === 'allow' && countries.length === 0) {
        return {success: false, message: 'allow mode requires at least one country'};
    }

    const warnings: string[] = [];
    if(mode !== 'off' && unknownPolicy === 'deny' && applyToAdmin === true) {
        warnings.push('unknownPolicy=deny with applyToAdmin=true also blocks private and loopback addresses from the admin console');
    }

    const geo: GeoConfig = {mode, countries, applyToAdmin, unknownPolicy};
    return {success: true, value: {geo}, warnings};
}
