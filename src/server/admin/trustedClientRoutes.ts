import crypto from "crypto";
import {ServerResponse} from "http";
import ServerOptionStore from "../ServerOptionStore";
import TTTServer from "../TTTServer";
import {IdentityStore} from "../rbac/IdentityStore";
import {TrustedClient} from "../../types/TunnelingOption";
import {RouteContext} from "./routes";
import ObjectUtil from "../../util/ObjectUtil";
import {MAX_ENROLLMENT_TTL_MS} from "../EnrollmentRegistry";

/**
 * 신뢰 클라이언트 관리 API(#212 REQ-1·1a·2·4·7). 비밀값은 서버가 만들고 응답에 싣지 않는다.
 * 클라이언트에는 등록 코드(client join)로만 전달한다.
 */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_DISPLAY_NAME_LENGTH = 128;
const MAX_ENROLLMENT_TTL_MINUTES = MAX_ENROLLMENT_TTL_MS / 60_000;

type TrustedClientRouteDeps = {
    tttServer: () => TTTServer | undefined;
    mutateConfiguration: (res: ServerResponse, payload: any, operation: (store: ServerOptionStore) => Promise<void>) => Promise<void>;
    /** 목록을 저장하고 런타임에 적용한다. 성공하면 새 revisionState, 실패하면 응답을 보낸 뒤 undefined. */
    commitTrustedClients: (res: ServerResponse, store: ServerOptionStore, next: TrustedClient[]) => Promise<object | undefined>;
    sendFailure: (res: ServerResponse, status: number, payload: object) => void;
};

const newSecret = (): string => crypto.randomBytes(32).toString("hex");

/** 서버 옵션 응답에서 비밀값 자리에 넣는 값(#212 REQ-9). */
const MASKED_SECRET = "********";

const maskTrustedClientSecrets = (clients: TrustedClient[]): TrustedClient[] =>
    clients.map((client) => ({...client, clientSecret: MASKED_SECRET}));

/**
 * 서버 옵션 저장 요청의 trustedClients 를 판정한다(#212 REQ-10). 없거나, 가린 비밀값을 지금 값으로 바꿨을 때
 * 지금 목록과 같으면 지금 목록을 돌려준다. 다르면 undefined(거부).
 */
const keepTrustedClients = (requested: unknown, current: TrustedClient[]): TrustedClient[] | undefined => {
    if(requested === undefined) return current;
    if(!Array.isArray(requested)) return undefined;
    const secretOf = new Map(current.map((client) => [client.clientId, client.clientSecret]));
    const normalize = (client: any) => {
        const clientId = typeof client?.clientId === "string" ? client.clientId.trim() : client?.clientId;
        const secret = client?.clientSecret === MASKED_SECRET ? secretOf.get(clientId) : client?.clientSecret;
        return {clientId, clientSecret: secret, displayName: client?.displayName || clientId};
    };
    return ObjectUtil.canonicalEquals(requested.map(normalize), current.map(normalize)) ? current : undefined;
};

const publicView = (client: TrustedClient) => ({clientId: client.clientId, ...(client.displayName ? {displayName: client.displayName} : {})});

/** 이 clientId 를 가리키는 터널·그룹. 남아 있으면 지우지 않는다(같은 id 로 다시 만들 때 예전 권한을 물려받지 않게). */
const referencesOf = (clientId: string): Array<{kind: "tunnel" | "group", id: string}> => [
    ...ServerOptionStore.instance.getTunnelingOptions()
        .filter((option) => (option.allowedClientIds ?? []).includes(clientId))
        .map((option) => ({kind: "tunnel" as const, id: String(option.forwardPort)})),
    ...IdentityStore.instance.groups()
        .filter((group) => (group.attributes?.allowed_trusted_clients ?? []).includes(clientId))
        .map((group) => ({kind: "group" as const, id: group.id}))
];

const trustedClientRouteHandlers = (deps: TrustedClientRouteDeps) => {
    const onCreateTrustedClient = async (ctx: RouteContext): Promise<void> => {
        const clientId = ctx.body?.clientId;
        const displayName = ctx.body?.displayName;
        if(typeof clientId !== "string" || !CLIENT_ID_PATTERN.test(clientId)) {
            ctx.fail(400, "INVALID_CLIENT_ID", "clientId must be 1-64 letters, digits, '.', '_' or '-'");
            return;
        }
        if(displayName !== undefined && (typeof displayName !== "string" || displayName.trim().length === 0 || displayName.length > MAX_DISPLAY_NAME_LENGTH)) {
            ctx.fail(400, "INVALID_DISPLAY_NAME", `displayName must be 1-${MAX_DISPLAY_NAME_LENGTH} characters`);
            return;
        }
        await deps.mutateConfiguration(ctx.res, ctx.body, async (store) => {
            const current = store.serverOption.trustedClients ?? [];
            if(current.some((client) => client.clientId === clientId)) {
                ctx.fail(409, "CLIENT_EXISTS", `trusted client '${clientId}' already exists`);
                return;
            }
            const created: TrustedClient = {clientId, clientSecret: newSecret(), ...(displayName ? {displayName: displayName.trim()} : {})};
            const revisionState = await deps.commitTrustedClients(ctx.res, store, [...current, created]);
            if(revisionState) ctx.ok({trustedClient: publicView(created), revisionState}, 201);
        });
    };

    const onDeleteTrustedClient = async (ctx: RouteContext): Promise<void> => {
        const clientId = ctx.params.id ?? "";
        await deps.mutateConfiguration(ctx.res, ctx.body ?? {}, async (store) => {
            const current = store.serverOption.trustedClients ?? [];
            if(!current.some((client) => client.clientId === clientId)) {
                ctx.fail(404, "CLIENT_NOT_FOUND", `trusted client '${clientId}' does not exist`);
                return;
            }
            const references = referencesOf(clientId);
            if(references.length > 0) {
                deps.sendFailure(ctx.res, 409, {code: "CLIENT_IN_USE",
                    message: `trusted client '${clientId}' is still allowed by tunnels or groups. Remove it there first.`, references});
                return;
            }
            const revisionState = await deps.commitTrustedClients(ctx.res, store, current.filter((client) => client.clientId !== clientId));
            if(revisionState) ctx.ok({revisionState});
        });
    };

    const onRotateTrustedClientSecret = async (ctx: RouteContext): Promise<void> => {
        const clientId = ctx.params.id ?? "";
        await deps.mutateConfiguration(ctx.res, ctx.body ?? {}, async (store) => {
            const current = store.serverOption.trustedClients ?? [];
            if(!current.some((client) => client.clientId === clientId)) {
                ctx.fail(404, "CLIENT_NOT_FOUND", `trusted client '${clientId}' does not exist`);
                return;
            }
            const next = current.map((client) => client.clientId === clientId ? {...client, clientSecret: newSecret()} : client);
            const revisionState = await deps.commitTrustedClients(ctx.res, store, next);
            if(revisionState) ctx.ok({trustedClient: publicView(next.find((client) => client.clientId === clientId)!), revisionState});
        });
    };

    const onIssueEnrollmentCode = async (ctx: RouteContext): Promise<void> => {
        const clientId = ctx.params.id ?? "";
        const ttlMinutes = ctx.body?.ttlMinutes;
        // #313: ttlMinutes 는 1..30일(분) 정수이거나 null(만료 없음)이다. 없으면 기본 15분이다.
        if(ttlMinutes !== undefined && ttlMinutes !== null && (!Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > MAX_ENROLLMENT_TTL_MINUTES)) {
            ctx.fail(400, "INVALID_TTL", `ttlMinutes must be null (no expiry) or an integer within 1..${MAX_ENROLLMENT_TTL_MINUTES}`);
            return;
        }
        // #313: provisional 이면 확인(confirm)할 때까지 기본 15분만 유효하다. 관리 화면이 코드를 보여 준 뒤 확인한다.
        const provisional = ctx.body?.provisional;
        if(provisional !== undefined && typeof provisional !== "boolean") {
            ctx.fail(400, "INVALID_PROVISIONAL", "provisional must be true or false");
            return;
        }
        const server = deps.tttServer();
        if(!server) {
            ctx.fail(503, "SERVER_NOT_READY", "the tunnel server is not running");
            return;
        }
        // 설정 변경과 한 줄로 세운다. 진행 중인 변경이 제어 포트를 바꾸면, 그 사이 낸 코드는 성공으로 나간 직후 무효가 된다.
        let issued!: Awaited<ReturnType<TTTServer["issueEnrollmentCode"]>>;
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            issued = await server.issueEnrollmentCode(clientId, ttlMinutes === undefined ? undefined : ttlMinutes === null ? null : ttlMinutes * 60_000,
                {provisional: provisional === true});
        });
        if(issued.ok) {
            ctx.ok({code: issued.code, expiresAt: issued.expiresAt, issueId: issued.issueId, controlPort: ServerOptionStore.instance.serverOption.port});
        } else if(issued.reason === "unknown-client") {
            ctx.fail(404, "CLIENT_NOT_FOUND", `trusted client '${clientId}' does not exist`);
        } else if(issued.reason === "superseded") {
            ctx.fail(409, "ENROLLMENT_SUPERSEDED", "a newer enrollment code request or a revocation replaced this request");
        } else if(issued.reason === "tls-required") {
            ctx.fail(409, "TLS_REQUIRED", "turn on TLS for the control port to use enrollment codes");
        } else {
            ctx.fail(409, "STRICT_MODE", "mtls-strict needs a client certificate, so enrollment codes cannot be used");
        }
    };

    /** 임시로 발급한 코드에 고른 기한을 적용한다(#313). 더 새 발급이나 무효화로 그 코드가 없으면 409 다. */
    const onConfirmEnrollmentCode = async (ctx: RouteContext): Promise<void> => {
        const clientId = ctx.params.id ?? "";
        const issueId = ctx.body?.issueId;
        if(!Number.isInteger(issueId) || issueId < 1) {
            ctx.fail(400, "INVALID_ISSUE_ID", "issueId must be the positive integer returned when the code was issued");
            return;
        }
        const server = deps.tttServer();
        if(!server) {
            ctx.fail(503, "SERVER_NOT_READY", "the tunnel server is not running");
            return;
        }
        let confirmed!: Awaited<ReturnType<TTTServer["confirmEnrollmentCode"]>>;
        await ServerOptionStore.instance.runConfigurationMutation(async () => {
            confirmed = await server.confirmEnrollmentCode(clientId, issueId);
        });
        if(confirmed.ok) {
            ctx.ok({expiresAt: confirmed.expiresAt});
        } else if(confirmed.reason === "unknown-client") {
            ctx.fail(404, "CLIENT_NOT_FOUND", `trusted client '${clientId}' does not exist`);
        } else {
            ctx.fail(409, "ENROLLMENT_SUPERSEDED", "this code was replaced, revoked or has expired; issue a new code");
        }
    };

    return {onCreateTrustedClient, onDeleteTrustedClient, onRotateTrustedClientSecret, onIssueEnrollmentCode, onConfirmEnrollmentCode};
};

export {trustedClientRouteHandlers, TrustedClientRouteDeps, CLIENT_ID_PATTERN, MASKED_SECRET, maskTrustedClientSecrets, keepTrustedClients};
