import crypto from "node:crypto";
import {isoCBOR} from "@simplewebauthn/server/helpers";

// #336 — 테스트용 소프트웨어 인증기. Node crypto 로 P-256 키를 만들고 실제 WebAuthn 응답(attestation none·서명)을
// 만든다. 서버는 라이브러리 검증을 그대로 거치므로 모의 객체가 아니다. 사용자 확인(UV)·카운터·Origin 등을 바꿔
// 실패 경로를 만들 수 있다.

type Credential = {id: Buffer; privateKey: crypto.KeyObject; publicKeyCose: Uint8Array; rpId: string; userHandle: string; counter: number};

export type CreateOverrides = {uv?: boolean; origin?: string; backedUp?: boolean; challenge?: string; rpId?: string; transports?: unknown; credentialId?: string};
export type GetOverrides = {
    uv?: boolean; origin?: string; challenge?: string; credentialId?: string; counter?: number;
    /** null 이면 userHandle 을 빼고, 문자열이면 그 base64url 값을 쓴다. */
    userHandle?: string | null; rpId?: string; tamperSignature?: boolean;
};

const b64 = (bytes: Uint8Array | Buffer): string => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Buffer | string): Buffer => crypto.createHash("sha256").update(data).digest();

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

export class SoftAuthenticator {
    public readonly credentials: Credential[] = [];

    public constructor(private readonly origin: string) {}

    /** navigator.credentials.create() 를 흉내 낸다. options 는 서버가 준 JSON 그대로다. */
    public create(options: any, overrides: CreateOverrides = {}): any {
        const {privateKey, publicKey} = crypto.generateKeyPairSync("ec", {namedCurve: "P-256"});
        const jwk = publicKey.export({format: "jwk"});
        const publicKeyCose = isoCBOR.encode(new Map<number, number | Uint8Array>([
            [1, 2], [3, -7], [-1, 1],
            [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]
        ]));
        const id = overrides.credentialId ? Buffer.from(overrides.credentialId, "base64url") : crypto.randomBytes(16);
        const rpId = overrides.rpId ?? options.rp.id;
        const credential: Credential = {id, privateKey, publicKeyCose, rpId, userHandle: options.user.id, counter: 0};
        this.credentials.push(credential);

        let flags = FLAG_UP | FLAG_AT;
        if(overrides.uv !== false) flags |= FLAG_UV;
        if(overrides.backedUp) flags |= FLAG_BE | FLAG_BS;
        const idLength = Buffer.alloc(2);
        idLength.writeUInt16BE(id.length);
        const authData = Buffer.concat([
            sha256(rpId), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), idLength, id, Buffer.from(publicKeyCose)
        ]);
        const clientDataJSON = Buffer.from(JSON.stringify({
            type: "webauthn.create", challenge: overrides.challenge ?? options.challenge, origin: overrides.origin ?? this.origin, crossOrigin: false
        }));
        const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", new Uint8Array(authData)]]) as any);
        return {
            id: b64(id), rawId: b64(id), type: "public-key", clientExtensionResults: {}, authenticatorAttachment: "platform",
            response: {
                clientDataJSON: b64(clientDataJSON), attestationObject: b64(attestationObject),
                transports: overrides.transports ?? ["internal", "hybrid"]
            }
        };
    }

    /** navigator.credentials.get() 를 흉내 낸다. 주어진 rpId 의 첫 자격증명을 고른다(discoverable). */
    public get(options: any, overrides: GetOverrides = {}): any {
        const rpId = overrides.rpId ?? options.rpId;
        const credential = overrides.credentialId
            ? this.credentials.find((entry) => b64(entry.id) === overrides.credentialId)
            : this.credentials.find((entry) => entry.rpId === rpId);
        if(!credential) throw new Error(`soft authenticator: no credential for ${rpId}`);
        credential.counter = overrides.counter ?? credential.counter + 1;
        const counter = Buffer.alloc(4);
        counter.writeUInt32BE(credential.counter);
        let flags = FLAG_UP;
        if(overrides.uv !== false) flags |= FLAG_UV;
        const authData = Buffer.concat([sha256(rpId), Buffer.from([flags]), counter]);
        const clientDataJSON = Buffer.from(JSON.stringify({
            type: "webauthn.get", challenge: overrides.challenge ?? options.challenge, origin: overrides.origin ?? this.origin, crossOrigin: false
        }));
        let signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), credential.privateKey);
        if(overrides.tamperSignature) signature = Buffer.from(signature.map((byte, i) => i === signature.length - 1 ? byte ^ 0x01 : byte));
        const userHandle = overrides.userHandle === null ? undefined : (overrides.userHandle ?? credential.userHandle);
        return {
            id: overrides.credentialId ?? b64(credential.id), rawId: overrides.credentialId ?? b64(credential.id), type: "public-key",
            clientExtensionResults: {}, authenticatorAttachment: "platform",
            response: {
                clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authData), signature: b64(signature),
                ...(userHandle === undefined ? {} : {userHandle})
            }
        };
    }
}
