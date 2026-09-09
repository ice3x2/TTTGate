import {createHmac} from "crypto";
import {ClockRngProvider} from "../util/ClockRng";

type ControlProtocolMode = "legacy" | "mixed" | "mtls-strict";
type ProtocolCapability = "protocol-v2" | "proof-of-possession" | "client-identity" | "data-bind-token" | "wide-id" | "close-count-safe";

type SyncCtrlAckMeta = {
    protocolVersion: number;
    capabilities: Array<ProtocolCapability>;
    challengeNonce: string;
    serverMode: ControlProtocolMode;
    controlID?: number;
};

type AckCtrlV2Meta = {
    protocolVersion: number;
    capabilities: Array<ProtocolCapability>;
    controlID?: number;
    clientId: string;
    displayName?: string;
    proof: string;
};

type NewDataHandlerMeta = {
    handlerID?: number;
    bindingToken?: string;
};

type HandlerWideIdMeta = {
    handlerID?: number;
};

type CloseSessionMeta = HandlerWideIdMeta & {waitReceiveLength?: number};

const CONTROL_PROTOCOL_V2 = 2;
const CONTROL_PROTOCOL_V1 = 1;
const DEFAULT_PROTOCOL_V2_CAPABILITIES: Array<ProtocolCapability> = [
    "protocol-v2",
    "proof-of-possession",
    "client-identity",
    "data-bind-token",
    "wide-id",
    "close-count-safe"
];

const buildHandshakeProof = (secret: string, clientId: string, handlerId: number, challengeNonce: string): string => {
    return createHmac("sha256", secret)
        .update(`${clientId}:${handlerId}:${challengeNonce}`)
        .digest("hex");
};

/**
 * P3-T1 / REQ-01: 불투명 토큰을 CSPRNG 기반으로 생성.
 *
 * 이전 구현은 `Math.random()`을 byte 단위로 반복 호출해 예측 가능한 시퀀스를
 * 만들었다. 현재 구현은 `ClockRngProvider.secureRandomBytes(n)`에 위임하며
 * 이는 `crypto.randomBytes(n)`를 호출한다(비편향 CSPRNG).
 *
 * `Math.random` / `rng.random()` 지터 경로와 분리된 단일 경로로 고정하여,
 * 향후 토큰 경로에 예측 가능 RNG가 다시 섞이는 것을 방지한다.
 */
const createOpaqueToken = (length: number = 32): string => {
    const rng = ClockRngProvider.current();
    return rng.secureRandomBytes(length).toString("hex");
};

export {
    CloseSessionMeta,
    AckCtrlV2Meta,
    CONTROL_PROTOCOL_V1,
    CONTROL_PROTOCOL_V2,
    ControlProtocolMode,
    createOpaqueToken,
    buildHandshakeProof,
    DEFAULT_PROTOCOL_V2_CAPABILITIES,
    HandlerWideIdMeta,
    NewDataHandlerMeta,
    ProtocolCapability,
    SyncCtrlAckMeta
};
