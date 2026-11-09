import {isIP} from "net";

// #336 — 관리 화면 패스키(WebAuthn)의 저장 형식과 값 검사. 저장소·라우트·화면 응답이 함께 쓰는 유일한 정의다.

export const PASSKEY_LIMIT = 20;
const NAME_MAX_LENGTH = 64;
const TRANSPORTS_MAX = 8;
const ALLOWED_TRANSPORTS = ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'cable', 'smart-card'] as const;

export type PasskeyTransport = typeof ALLOWED_TRANSPORTS[number];

/** identity.yaml 의 사용자 항목에 저장하는 패스키. publicKey 는 API 응답·감사·로그에 넣지 않는다. */
export type Passkey = {
    id: string;                     // 자격증명 ID, base64url
    publicKey: string;              // COSE 공개키, base64url
    counter: number;
    transports: PasskeyTransport[];
    rpId: string;
    name: string;
    createdAt: number;
    lastUsedAt?: number;
    backedUp: boolean;
};

/** 화면에 보이는 패스키. 공개키는 담지 않는다. */
export type PasskeyView = {id: string; name: string; rpId: string; createdAt: number; lastUsedAt: number | null; backedUp: boolean};

/** 앞뒤 공백을 뺀 1~64자면 다듬은 값, 아니면 undefined. */
export function passkeyNameOf(value: unknown): string | undefined {
    if(typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length >= 1 && trimmed.length <= NAME_MAX_LENGTH ? trimmed : undefined;
}

/** 서명되지 않은 클라이언트 값이다. 허용한 값만 중복 없이 남기고 최대 8개로 자른다. */
export function sanitizeTransports(value: unknown): PasskeyTransport[] {
    if(!Array.isArray(value)) return [];
    const kept = new Set<PasskeyTransport>();
    for(const entry of value) {
        if((ALLOWED_TRANSPORTS as readonly unknown[]).includes(entry)) kept.add(entry as PasskeyTransport);
    }
    return [...kept].slice(0, TRANSPORTS_MAX);
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isNonNegativeInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** 파일에서 읽은 항목이 Passkey 모양인지 본다. 틀린 항목은 읽을 때 버린다. */
export function isStoredPasskey(value: unknown): value is Passkey {
    if(typeof value !== 'object' || value === null) return false;
    const entry = value as Record<string, unknown>;
    return isNonEmptyString(entry.id) && isNonEmptyString(entry.publicKey) && isNonNegativeInt(entry.counter)
        && Array.isArray(entry.transports) && isNonEmptyString(entry.rpId) && passkeyNameOf(entry.name) === entry.name
        && isNonNegativeInt(entry.createdAt) && (entry.lastUsedAt === undefined || isNonNegativeInt(entry.lastUsedAt))
        && typeof entry.backedUp === 'boolean';
}

export function toPasskeyView(passkey: Passkey): PasskeyView {
    return {
        id: passkey.id, name: passkey.name, rpId: passkey.rpId, createdAt: passkey.createdAt,
        lastUsedAt: passkey.lastUsedAt ?? null, backedUp: passkey.backedUp
    };
}

/**
 * 패스키를 쓸 수 있는 Origin 이면 그 RP ID(호스트 이름)를, 아니면 undefined 를 돌려준다.
 * 호스트 이름이 IP 주소가 아니고, https 이거나 localhost 여야 한다(WebAuthn 은 IP 주소를 RP ID 로 받지 않는다).
 */
export function passkeyRpIdOf(origin: string | undefined): string | undefined {
    if(origin === undefined || !URL.canParse(origin)) return undefined;
    const url = new URL(origin);
    const host = url.hostname;
    const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
    if(bare.length === 0 || isIP(bare) !== 0) return undefined;
    if(url.protocol === 'https:') return host;
    return url.protocol === 'http:' && host === 'localhost' ? host : undefined;
}
