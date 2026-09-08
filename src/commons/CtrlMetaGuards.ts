/**
 * R2-REQ-04 — CtrlPacket 메타 JSON 스키마 런타임 가드.
 *
 * 설계 원칙 (SPEC + Plan §6 R8 성능 가드):
 *  - O(필드수) 경량 검사(typeof + 문자열 길이 상한)만 수행.
 *  - 깊은 순회·재귀·정규식 매칭 금지. 마이크로 벤치(10k parse) 기준 기존 대비 < 5% 오버헤드.
 *  - `__proto__` / `constructor` / `prototype` 키 reviver로 drop → prototype pollution 차단.
 *  - 기존 assert/getter는 throw 계약 유지. 실시간 소비자는 공용 검증 결과로 무효 패킷만 폐기.
 *
 * 6곳 JSON.parse ↔ 5 guard 매핑 (Plan §4 Phase 2 P2-T3):
 *  - line 107 getMessageFromPacket          → assertMessageMeta
 *  - line 213 syncCtrlAckMeta getter        → assertSyncCtrlAckMeta
 *  - line 220 newDataHandlerMeta getter     → assertNewDataHandlerMeta
 *  - line 232 handlerWideIdMeta(FailOpen/SuccessOpen/SuccessOpenAck) → assertHandlerWideIdMeta
 *  - line 238 handlerWideIdMeta(CloseSession)                       → assertHandlerWideIdMeta (공유)
 *  - line 318 parseAckCtrlData v2 블록      → assertAckCtrlV2Meta
 */

import { AckCtrlV2Meta, HandlerWideIdMeta, NewDataHandlerMeta, SyncCtrlAckMeta } from "./ProtocolV2";

// 기본 문자열 필드 상한 (필요 시 환경변수로 조정).
const DEFAULT_STRING_LIMIT = 8192;

export type MessageMeta = { type: string; payload: object | string };

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
    return typeof v === "object" && v !== null && !Array.isArray(v);
};

const isStringCapped = (v: unknown, max: number = DEFAULT_STRING_LIMIT): v is string => {
    return typeof v === "string" && v.length <= max;
};

const isUInt = (v: unknown, max: number): v is number => {
    return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max && Number.isInteger(v);
};

const isCapabilityArray = (v: unknown): v is Array<string> => {
    if(!Array.isArray(v)) return false;
    if(v.length > 32) return false;
    for(const item of v) {
        if(!isStringCapped(item, 64)) return false;
    }
    return true;
};

export function validateMessageMeta(obj: unknown): string | undefined {
    if(!isPlainObject(obj)) return "MessageMeta: not object";
    if(!isStringCapped(obj.type, 128)) return "MessageMeta.type invalid";
    const payload = obj.payload;
    if(payload === undefined) return "MessageMeta.payload missing";
    if(typeof payload !== "string" && !isPlainObject(payload) && !Array.isArray(payload)) {
        return "MessageMeta.payload type invalid";
    }
    if(typeof payload === "string" && payload.length > DEFAULT_STRING_LIMIT) {
        return "MessageMeta.payload too long";
    }
}

export function assertMessageMeta(obj: unknown): asserts obj is MessageMeta {
    const reason = validateMessageMeta(obj);
    if(reason) throw new Error(reason);
}

export function validateSyncCtrlAckMeta(obj: unknown): string | undefined {
    if(!isPlainObject(obj)) return "SyncCtrlAckMeta: not object";
    if(!isUInt(obj.protocolVersion, 65535)) return "SyncCtrlAckMeta.protocolVersion invalid";
    if(!isCapabilityArray(obj.capabilities)) return "SyncCtrlAckMeta.capabilities invalid";
    if(!isStringCapped(obj.challengeNonce, 256)) return "SyncCtrlAckMeta.challengeNonce invalid";
    if(!isStringCapped(obj.serverMode, 32)) return "SyncCtrlAckMeta.serverMode invalid";
    if(obj.controlID !== undefined && !isUInt(obj.controlID, 0xFFFFFFFF)) {
        return "SyncCtrlAckMeta.controlID invalid";
    }
}

export function assertSyncCtrlAckMeta(obj: unknown): asserts obj is SyncCtrlAckMeta {
    const reason = validateSyncCtrlAckMeta(obj);
    if(reason) throw new Error(reason);
}

export function validateNewDataHandlerMeta(obj: unknown): string | undefined {
    if(!isPlainObject(obj)) return "NewDataHandlerMeta: not object";
    if(obj.handlerID !== undefined && !isUInt(obj.handlerID, 0xFFFFFFFF)) {
        return "NewDataHandlerMeta.handlerID invalid";
    }
    if(obj.bindingToken !== undefined && !isStringCapped(obj.bindingToken, 512)) {
        return "NewDataHandlerMeta.bindingToken invalid";
    }
}

export function assertNewDataHandlerMeta(obj: unknown): asserts obj is NewDataHandlerMeta {
    const reason = validateNewDataHandlerMeta(obj);
    if(reason) throw new Error(reason);
}

export function validateHandlerWideIdMeta(obj: unknown): string | undefined {
    if(!isPlainObject(obj)) return "HandlerWideIdMeta: not object";
    if(obj.handlerID !== undefined && !isUInt(obj.handlerID, 0xFFFFFFFF)) {
        return "HandlerWideIdMeta.handlerID invalid";
    }
}

export function assertHandlerWideIdMeta(obj: unknown): asserts obj is HandlerWideIdMeta {
    const reason = validateHandlerWideIdMeta(obj);
    if(reason) throw new Error(reason);
}

export function assertAckCtrlV2Meta(obj: unknown): asserts obj is AckCtrlV2Meta {
    if(!isPlainObject(obj)) throw new Error("AckCtrlV2Meta: not object");
    if(!isUInt(obj.protocolVersion, 65535)) throw new Error("AckCtrlV2Meta.protocolVersion invalid");
    if(!isCapabilityArray(obj.capabilities)) throw new Error("AckCtrlV2Meta.capabilities invalid");
    if(!isStringCapped(obj.clientId, 256)) throw new Error("AckCtrlV2Meta.clientId invalid");
    if(!isStringCapped(obj.proof, 512)) throw new Error("AckCtrlV2Meta.proof invalid");
    if(obj.controlID !== undefined && !isUInt(obj.controlID, 0xFFFFFFFF)) {
        throw new Error("AckCtrlV2Meta.controlID invalid");
    }
    if(obj.displayName !== undefined && !isStringCapped(obj.displayName, 256)) {
        throw new Error("AckCtrlV2Meta.displayName invalid");
    }
}

/**
 * prototype pollution 차단 reviver + 가드 통합 파서.
 *
 * reviver는 `__proto__` / `constructor` / `prototype` 키를 drop 하여
 * `JSON.parse`가 `Object.prototype` 체인을 오염시키지 못하게 한다.
 */
const SAFE_REVIVER = (key: string, value: unknown): unknown => {
    if(key === "__proto__" || key === "constructor" || key === "prototype") {
        return undefined;
    }
    return value;
};

export type MetaResult<T> = {kind: 'absent'} | {kind: 'invalid'; reason: string} | {kind: 'valid'; value: T};

export function readJsonMeta<T>(data: Buffer, validate: (obj: unknown) => string | undefined): MetaResult<T> {
    let parsed: unknown;
    const text = data.toString('utf8');
    try {
        parsed = JSON.parse(text, SAFE_REVIVER);
    } catch(error) {
        if(error instanceof SyntaxError) return {kind: 'invalid', reason: 'Invalid metadata JSON'};
        throw error;
    }
    const reason = validate(parsed);
    return reason ? {kind: 'invalid', reason} : {kind: 'valid', value: parsed as T};
}

export function safeJsonParse<T>(
    data: Buffer | string,
    assertFn: (obj: unknown) => asserts obj is T
): T {
    const text = Buffer.isBuffer(data) ? data.toString("utf-8") : data;
    const parsed = JSON.parse(text, SAFE_REVIVER);
    assertFn(parsed);
    return parsed;
}
