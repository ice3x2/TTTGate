import {TrustedClient} from "../types/TunnelingOption";
import {createOpaqueToken} from "../commons/ProtocolV2";
import {ClockRngProvider} from "../util/ClockRng";
import {timingSafeStringEqual} from "../util/timingSafeStringEqual";

type AuthenticatedClientIdentity = {
    clientId: string;
    displayName: string;
    protocolVersion: number;
    capabilities: string[];
    legacy: boolean;
};

type BindingTokenRecord = {
    clientId: string;
    ctrlID: number;
    handlerID: number;
    sessionID: number;
    expiresAt: number;
    token: string;
};

const BINDING_TOKEN_TTL_MS = 30_000;

class IdentityRegistry {
    private readonly _trustedClientMap = new Map<string, TrustedClient>();
    private readonly _bindingTokenMap = new Map<string, BindingTokenRecord>();

    public constructor(trustedClients: Array<TrustedClient> = []) {
        trustedClients.forEach((trustedClient) => {
            this._trustedClientMap.set(trustedClient.clientId, {...trustedClient});
        });
    }

    public findTrustedClient(clientId: string): TrustedClient | undefined {
        const trustedClient = this._trustedClientMap.get(clientId);
        if(!trustedClient) {
            return undefined;
        }
        return {...trustedClient};
    }

    public issueBindingToken(clientId: string, ctrlID: number, handlerID: number, sessionID: number): string {
        this.pruneExpiredBindingTokens();
        const token = createOpaqueToken(24);
        const record: BindingTokenRecord = {
            clientId,
            ctrlID,
            handlerID,
            sessionID,
            token,
            expiresAt: ClockRngProvider.current().now() + BINDING_TOKEN_TTL_MS
        };
        this._bindingTokenMap.set(token, record);
        return token;
    }

    public consumeBindingToken(token: string, expected: {clientId: string, ctrlID: number, handlerID: number, sessionID: number}): boolean {
        this.pruneExpiredBindingTokens();
        const record = this._bindingTokenMap.get(token);
        if(!record) {
            return false;
        }
        // P3-T4 / REQ-04: clientId(=비밀 식별자)는 상수시간 비교.
        // ctrlID/handlerID/sessionID는 32/64-bit 정수이며 비밀이 아니므로
        // 일반 === 비교를 유지한다. lint-auth-compare가 sessionID 식별자를
        // 휴리스틱으로 잡지만 의미상 비밀이 아님을 allow 주석으로 명시.
        const idMatches = Number(record.ctrlID) === Number(expected.ctrlID)
            && Number(record.handlerID) === Number(expected.handlerID)
            && Number(record.sessionID) === Number(expected.sessionID); // lint-auth-compare-allow
        const clientIdMatches = timingSafeStringEqual(record.clientId, expected.clientId, "utf8");
        const matches = idMatches && clientIdMatches;
        this._bindingTokenMap.delete(token);
        return matches;
    }

    public revokeClientTokens(clientId: string): void {
        Array.from(this._bindingTokenMap.entries()).forEach(([token, record]) => {
            if(record.clientId === clientId) {
                this._bindingTokenMap.delete(token);
            }
        });
    }

    public pruneExpiredBindingTokens(): void {
        const now = ClockRngProvider.current().now();
        Array.from(this._bindingTokenMap.entries()).forEach(([token, record]) => {
            if(record.expiresAt <= now) {
                this._bindingTokenMap.delete(token);
            }
        });
    }

    public clear(): void {
        this._bindingTokenMap.clear();
    }
}

export {AuthenticatedClientIdentity, IdentityRegistry};
