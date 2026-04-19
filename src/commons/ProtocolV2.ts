import {createHmac} from "crypto";
import {ClockRngProvider} from "../util/ClockRng";

type ControlProtocolMode = "legacy" | "mixed" | "mtls-strict";
type ProtocolCapability = "protocol-v2" | "proof-of-possession" | "client-identity" | "data-bind-token" | "wide-id";

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

const CONTROL_PROTOCOL_V2 = 2;
const CONTROL_PROTOCOL_V1 = 1;
const DEFAULT_PROTOCOL_V2_CAPABILITIES: Array<ProtocolCapability> = [
    "protocol-v2",
    "proof-of-possession",
    "client-identity",
    "data-bind-token",
    "wide-id"
];

const buildHandshakeProof = (secret: string, clientId: string, handlerId: number, challengeNonce: string): string => {
    return createHmac("sha256", secret)
        .update(`${clientId}:${handlerId}:${challengeNonce}`)
        .digest("hex");
};

const createOpaqueToken = (length: number = 32): string => {
    const rng = ClockRngProvider.current();
    const bytes: number[] = [];
    for(let i = 0; i < length; i++) {
        bytes.push(Math.floor(rng.random() * 256));
    }
    return Buffer.from(bytes).toString("hex");
};

export {
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
