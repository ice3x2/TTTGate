import {authorize, Action, Decision, sections, Target} from "../../../../src/server/rbac/AdminAuthorizer";
import {Principal} from "../../../../src/server/rbac/Principal";
import {
    AdminUiSection,
    cloneGroupAttributes,
    DEFAULT_GROUP_ATTRIBUTES,
    GroupAttributes,
    SYSTEM_SUPERUSER_GROUP_ID,
    TunnelCrud,
    TunnelVisibility
} from "../../../../src/server/rbac/IdentityTypes";

const SELF_USER_ID = "u_self";
const SELF_GROUP_ID = "g_self";
const OTHER_USER_ID = "u_other";
const OTHER_GROUP_ID = "g_other";

const attributesOf = (patch: Partial<GroupAttributes>): GroupAttributes => ({...cloneGroupAttributes(DEFAULT_GROUP_ATTRIBUTES), ...patch});

const regularPrincipal = (tunnelCrud: TunnelCrud, tunnelVisibility: TunnelVisibility): Principal => ({
    userId: SELF_USER_ID,
    username: "alice",
    role: "regular",
    groupId: SELF_GROUP_ID,
    attributes: attributesOf({tunnel_crud: tunnelCrud, tunnel_visibility: tunnelVisibility}),
    mustChangePassword: false
});

const PRINCIPALS: {[name: string]: Principal} = {
    "superuser": {
        userId: "u_root",
        username: "root",
        role: "superuser",
        groupId: SYSTEM_SUPERUSER_GROUP_ID,
        attributes: cloneGroupAttributes(DEFAULT_GROUP_ATTRIBUTES),
        mustChangePassword: false
    },
    "regular(full,private)": regularPrincipal("full", "private"),
    "regular(read_only,group_read)": regularPrincipal("read_only", "group_read"),
    "regular(none)": regularPrincipal("none", "private")
};

const TARGETS: {[name: string]: Target} = {
    "own": {port: 1, owner: {userId: SELF_USER_ID, groupId: SELF_GROUP_ID}},
    "same-group-other": {port: 1, owner: {userId: OTHER_USER_ID, groupId: SELF_GROUP_ID}},
    "other-group-other": {port: 1, owner: {userId: OTHER_USER_ID, groupId: OTHER_GROUP_ID}},
    "no-owner": {port: 1}
};

// 이슈 #96 의 규칙 표에서 손으로 계산한 기대값. 주체 4종 x 대상 4종 x action 19종 = 304 조합 전수.
const MATRIX: ReadonlyArray<[string, Action, string, Decision]> = [
    // ---- superuser: mustChangePassword 가 아니면 전부 허용 ----
    ["superuser", "user:manage", "own", {allowed: true}],
    ["superuser", "user:manage", "same-group-other", {allowed: true}],
    ["superuser", "user:manage", "other-group-other", {allowed: true}],
    ["superuser", "user:manage", "no-owner", {allowed: true}],
    ["superuser", "group:manage", "own", {allowed: true}],
    ["superuser", "group:manage", "same-group-other", {allowed: true}],
    ["superuser", "group:manage", "other-group-other", {allowed: true}],
    ["superuser", "group:manage", "no-owner", {allowed: true}],
    ["superuser", "server:manage", "own", {allowed: true}],
    ["superuser", "server:manage", "same-group-other", {allowed: true}],
    ["superuser", "server:manage", "other-group-other", {allowed: true}],
    ["superuser", "server:manage", "no-owner", {allowed: true}],
    ["superuser", "security:manage", "own", {allowed: true}],
    ["superuser", "security:manage", "same-group-other", {allowed: true}],
    ["superuser", "security:manage", "other-group-other", {allowed: true}],
    ["superuser", "security:manage", "no-owner", {allowed: true}],
    ["superuser", "session:manage", "own", {allowed: true}],
    ["superuser", "session:manage", "same-group-other", {allowed: true}],
    ["superuser", "session:manage", "other-group-other", {allowed: true}],
    ["superuser", "session:manage", "no-owner", {allowed: true}],
    ["superuser", "audit:read-all", "own", {allowed: true}],
    ["superuser", "audit:read-all", "same-group-other", {allowed: true}],
    ["superuser", "audit:read-all", "other-group-other", {allowed: true}],
    ["superuser", "audit:read-all", "no-owner", {allowed: true}],
    ["superuser", "tunnel:list", "own", {allowed: true}],
    ["superuser", "tunnel:list", "same-group-other", {allowed: true}],
    ["superuser", "tunnel:list", "other-group-other", {allowed: true}],
    ["superuser", "tunnel:list", "no-owner", {allowed: true}],
    ["superuser", "tunnel:create", "own", {allowed: true}],
    ["superuser", "tunnel:create", "same-group-other", {allowed: true}],
    ["superuser", "tunnel:create", "other-group-other", {allowed: true}],
    ["superuser", "tunnel:create", "no-owner", {allowed: true}],
    ["superuser", "tunnel:read", "own", {allowed: true}],
    ["superuser", "tunnel:read", "same-group-other", {allowed: true}],
    ["superuser", "tunnel:read", "other-group-other", {allowed: true}],
    ["superuser", "tunnel:read", "no-owner", {allowed: true}],
    ["superuser", "tunnel:update", "own", {allowed: true}],
    ["superuser", "tunnel:update", "same-group-other", {allowed: true}],
    ["superuser", "tunnel:update", "other-group-other", {allowed: true}],
    ["superuser", "tunnel:update", "no-owner", {allowed: true}],
    ["superuser", "tunnel:delete", "own", {allowed: true}],
    ["superuser", "tunnel:delete", "same-group-other", {allowed: true}],
    ["superuser", "tunnel:delete", "other-group-other", {allowed: true}],
    ["superuser", "tunnel:delete", "no-owner", {allowed: true}],
    ["superuser", "tunnel:activate", "own", {allowed: true}],
    ["superuser", "tunnel:activate", "same-group-other", {allowed: true}],
    ["superuser", "tunnel:activate", "other-group-other", {allowed: true}],
    ["superuser", "tunnel:activate", "no-owner", {allowed: true}],
    ["superuser", "tunnel:cert", "own", {allowed: true}],
    ["superuser", "tunnel:cert", "same-group-other", {allowed: true}],
    ["superuser", "tunnel:cert", "other-group-other", {allowed: true}],
    ["superuser", "tunnel:cert", "no-owner", {allowed: true}],
    ["superuser", "tunnel:reassign", "own", {allowed: true}],
    ["superuser", "tunnel:reassign", "same-group-other", {allowed: true}],
    ["superuser", "tunnel:reassign", "other-group-other", {allowed: true}],
    ["superuser", "tunnel:reassign", "no-owner", {allowed: true}],
    ["superuser", "status:read", "own", {allowed: true}],
    ["superuser", "status:read", "same-group-other", {allowed: true}],
    ["superuser", "status:read", "other-group-other", {allowed: true}],
    ["superuser", "status:read", "no-owner", {allowed: true}],
    ["superuser", "me:read", "own", {allowed: true}],
    ["superuser", "me:read", "same-group-other", {allowed: true}],
    ["superuser", "me:read", "other-group-other", {allowed: true}],
    ["superuser", "me:read", "no-owner", {allowed: true}],
    ["superuser", "me:password", "own", {allowed: true}],
    ["superuser", "me:password", "same-group-other", {allowed: true}],
    ["superuser", "me:password", "other-group-other", {allowed: true}],
    ["superuser", "me:password", "no-owner", {allowed: true}],
    ["superuser", "me:sessions", "own", {allowed: true}],
    ["superuser", "me:sessions", "same-group-other", {allowed: true}],
    ["superuser", "me:sessions", "other-group-other", {allowed: true}],
    ["superuser", "me:sessions", "no-owner", {allowed: true}],
    ["superuser", "audit:read-self", "own", {allowed: true}],
    ["superuser", "audit:read-self", "same-group-other", {allowed: true}],
    ["superuser", "audit:read-self", "other-group-other", {allowed: true}],
    ["superuser", "audit:read-self", "no-owner", {allowed: true}],

    // ---- regular(full,private) ----
    ["regular(full,private)", "user:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "user:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "user:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "user:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "group:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "group:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "group:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "group:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "server:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "server:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "server:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "server:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "security:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "security:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "security:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "security:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "session:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "session:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "session:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "session:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "audit:read-all", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "audit:read-all", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "audit:read-all", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "audit:read-all", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "tunnel:list", "own", {allowed: true}],
    ["regular(full,private)", "tunnel:list", "same-group-other", {allowed: true}],
    ["regular(full,private)", "tunnel:list", "other-group-other", {allowed: true}],
    ["regular(full,private)", "tunnel:list", "no-owner", {allowed: true}],
    ["regular(full,private)", "tunnel:create", "own", {allowed: true}],
    ["regular(full,private)", "tunnel:create", "same-group-other", {allowed: true}],
    ["regular(full,private)", "tunnel:create", "other-group-other", {allowed: true}],
    ["regular(full,private)", "tunnel:create", "no-owner", {allowed: true}],
    ["regular(full,private)", "tunnel:read", "own", {allowed: true}],
    ["regular(full,private)", "tunnel:read", "same-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(full,private)", "tunnel:read", "other-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(full,private)", "tunnel:read", "no-owner", {allowed: false, status: 404, code: "not_found"}],
    ["regular(full,private)", "tunnel:update", "own", {allowed: true}],
    ["regular(full,private)", "tunnel:update", "same-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(full,private)", "tunnel:update", "other-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(full,private)", "tunnel:update", "no-owner", {allowed: false, status: 404, code: "not_found"}],
    ["regular(full,private)", "tunnel:delete", "own", {allowed: true}],
    ["regular(full,private)", "tunnel:delete", "same-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(full,private)", "tunnel:delete", "other-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(full,private)", "tunnel:delete", "no-owner", {allowed: false, status: 404, code: "not_found"}],
    ["regular(full,private)", "tunnel:activate", "own", {allowed: true}],
    ["regular(full,private)", "tunnel:activate", "same-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(full,private)", "tunnel:activate", "other-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(full,private)", "tunnel:activate", "no-owner", {allowed: false, status: 404, code: "not_found"}],
    ["regular(full,private)", "tunnel:cert", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "tunnel:cert", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "tunnel:cert", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "tunnel:cert", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "tunnel:reassign", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "tunnel:reassign", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "tunnel:reassign", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "tunnel:reassign", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "status:read", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "status:read", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "status:read", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "status:read", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(full,private)", "me:read", "own", {allowed: true}],
    ["regular(full,private)", "me:read", "same-group-other", {allowed: true}],
    ["regular(full,private)", "me:read", "other-group-other", {allowed: true}],
    ["regular(full,private)", "me:read", "no-owner", {allowed: true}],
    ["regular(full,private)", "me:password", "own", {allowed: true}],
    ["regular(full,private)", "me:password", "same-group-other", {allowed: true}],
    ["regular(full,private)", "me:password", "other-group-other", {allowed: true}],
    ["regular(full,private)", "me:password", "no-owner", {allowed: true}],
    ["regular(full,private)", "me:sessions", "own", {allowed: true}],
    ["regular(full,private)", "me:sessions", "same-group-other", {allowed: true}],
    ["regular(full,private)", "me:sessions", "other-group-other", {allowed: true}],
    ["regular(full,private)", "me:sessions", "no-owner", {allowed: true}],
    ["regular(full,private)", "audit:read-self", "own", {allowed: true}],
    ["regular(full,private)", "audit:read-self", "same-group-other", {allowed: true}],
    ["regular(full,private)", "audit:read-self", "other-group-other", {allowed: true}],
    ["regular(full,private)", "audit:read-self", "no-owner", {allowed: true}],

    // ---- regular(read_only,group_read) ----
    ["regular(read_only,group_read)", "user:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "user:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "user:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "user:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "group:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "group:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "group:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "group:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "server:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "server:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "server:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "server:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "security:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "security:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "security:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "security:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "session:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "session:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "session:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "session:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "audit:read-all", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "audit:read-all", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "audit:read-all", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "audit:read-all", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "tunnel:list", "own", {allowed: true}],
    ["regular(read_only,group_read)", "tunnel:list", "same-group-other", {allowed: true}],
    ["regular(read_only,group_read)", "tunnel:list", "other-group-other", {allowed: true}],
    ["regular(read_only,group_read)", "tunnel:list", "no-owner", {allowed: true}],
    ["regular(read_only,group_read)", "tunnel:create", "own", {allowed: false, status: 403, code: "tunnel_create_forbidden"}],
    ["regular(read_only,group_read)", "tunnel:create", "same-group-other", {allowed: false, status: 403, code: "tunnel_create_forbidden"}],
    ["regular(read_only,group_read)", "tunnel:create", "other-group-other", {allowed: false, status: 403, code: "tunnel_create_forbidden"}],
    ["regular(read_only,group_read)", "tunnel:create", "no-owner", {allowed: false, status: 403, code: "tunnel_create_forbidden"}],
    ["regular(read_only,group_read)", "tunnel:read", "own", {allowed: true}],
    ["regular(read_only,group_read)", "tunnel:read", "same-group-other", {allowed: true}],
    ["regular(read_only,group_read)", "tunnel:read", "other-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(read_only,group_read)", "tunnel:read", "no-owner", {allowed: false, status: 404, code: "not_found"}],
    ["regular(read_only,group_read)", "tunnel:update", "own", {allowed: false, status: 403, code: "read_only"}],
    ["regular(read_only,group_read)", "tunnel:update", "same-group-other", {allowed: false, status: 403, code: "read_only"}],
    ["regular(read_only,group_read)", "tunnel:update", "other-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(read_only,group_read)", "tunnel:update", "no-owner", {allowed: false, status: 404, code: "not_found"}],
    ["regular(read_only,group_read)", "tunnel:delete", "own", {allowed: false, status: 403, code: "read_only"}],
    ["regular(read_only,group_read)", "tunnel:delete", "same-group-other", {allowed: false, status: 403, code: "read_only"}],
    ["regular(read_only,group_read)", "tunnel:delete", "other-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(read_only,group_read)", "tunnel:delete", "no-owner", {allowed: false, status: 404, code: "not_found"}],
    ["regular(read_only,group_read)", "tunnel:activate", "own", {allowed: false, status: 403, code: "read_only"}],
    ["regular(read_only,group_read)", "tunnel:activate", "same-group-other", {allowed: false, status: 403, code: "read_only"}],
    ["regular(read_only,group_read)", "tunnel:activate", "other-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(read_only,group_read)", "tunnel:activate", "no-owner", {allowed: false, status: 404, code: "not_found"}],
    ["regular(read_only,group_read)", "tunnel:cert", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "tunnel:cert", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "tunnel:cert", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "tunnel:cert", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "tunnel:reassign", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "tunnel:reassign", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "tunnel:reassign", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "tunnel:reassign", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "status:read", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "status:read", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "status:read", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "status:read", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(read_only,group_read)", "me:read", "own", {allowed: true}],
    ["regular(read_only,group_read)", "me:read", "same-group-other", {allowed: true}],
    ["regular(read_only,group_read)", "me:read", "other-group-other", {allowed: true}],
    ["regular(read_only,group_read)", "me:read", "no-owner", {allowed: true}],
    ["regular(read_only,group_read)", "me:password", "own", {allowed: true}],
    ["regular(read_only,group_read)", "me:password", "same-group-other", {allowed: true}],
    ["regular(read_only,group_read)", "me:password", "other-group-other", {allowed: true}],
    ["regular(read_only,group_read)", "me:password", "no-owner", {allowed: true}],
    ["regular(read_only,group_read)", "me:sessions", "own", {allowed: true}],
    ["regular(read_only,group_read)", "me:sessions", "same-group-other", {allowed: true}],
    ["regular(read_only,group_read)", "me:sessions", "other-group-other", {allowed: true}],
    ["regular(read_only,group_read)", "me:sessions", "no-owner", {allowed: true}],
    ["regular(read_only,group_read)", "audit:read-self", "own", {allowed: true}],
    ["regular(read_only,group_read)", "audit:read-self", "same-group-other", {allowed: true}],
    ["regular(read_only,group_read)", "audit:read-self", "other-group-other", {allowed: true}],
    ["regular(read_only,group_read)", "audit:read-self", "no-owner", {allowed: true}],

    // ---- regular(none) ----
    ["regular(none)", "user:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "user:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "user:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "user:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "group:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "group:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "group:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "group:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "server:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "server:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "server:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "server:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "security:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "security:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "security:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "security:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "session:manage", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "session:manage", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "session:manage", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "session:manage", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "audit:read-all", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "audit:read-all", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "audit:read-all", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "audit:read-all", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "tunnel:list", "own", {allowed: false, status: 403, code: "tunnel_access_disabled"}],
    ["regular(none)", "tunnel:list", "same-group-other", {allowed: false, status: 403, code: "tunnel_access_disabled"}],
    ["regular(none)", "tunnel:list", "other-group-other", {allowed: false, status: 403, code: "tunnel_access_disabled"}],
    ["regular(none)", "tunnel:list", "no-owner", {allowed: false, status: 403, code: "tunnel_access_disabled"}],
    ["regular(none)", "tunnel:create", "own", {allowed: false, status: 403, code: "tunnel_create_forbidden"}],
    ["regular(none)", "tunnel:create", "same-group-other", {allowed: false, status: 403, code: "tunnel_create_forbidden"}],
    ["regular(none)", "tunnel:create", "other-group-other", {allowed: false, status: 403, code: "tunnel_create_forbidden"}],
    ["regular(none)", "tunnel:create", "no-owner", {allowed: false, status: 403, code: "tunnel_create_forbidden"}],
    ["regular(none)", "tunnel:read", "own", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:read", "same-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:read", "other-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:read", "no-owner", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:update", "own", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:update", "same-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:update", "other-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:update", "no-owner", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:delete", "own", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:delete", "same-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:delete", "other-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:delete", "no-owner", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:activate", "own", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:activate", "same-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:activate", "other-group-other", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:activate", "no-owner", {allowed: false, status: 404, code: "not_found"}],
    ["regular(none)", "tunnel:cert", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "tunnel:cert", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "tunnel:cert", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "tunnel:cert", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "tunnel:reassign", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "tunnel:reassign", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "tunnel:reassign", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "tunnel:reassign", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "status:read", "own", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "status:read", "same-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "status:read", "other-group-other", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "status:read", "no-owner", {allowed: false, status: 403, code: "forbidden"}],
    ["regular(none)", "me:read", "own", {allowed: true}],
    ["regular(none)", "me:read", "same-group-other", {allowed: true}],
    ["regular(none)", "me:read", "other-group-other", {allowed: true}],
    ["regular(none)", "me:read", "no-owner", {allowed: true}],
    ["regular(none)", "me:password", "own", {allowed: true}],
    ["regular(none)", "me:password", "same-group-other", {allowed: true}],
    ["regular(none)", "me:password", "other-group-other", {allowed: true}],
    ["regular(none)", "me:password", "no-owner", {allowed: true}],
    ["regular(none)", "me:sessions", "own", {allowed: true}],
    ["regular(none)", "me:sessions", "same-group-other", {allowed: true}],
    ["regular(none)", "me:sessions", "other-group-other", {allowed: true}],
    ["regular(none)", "me:sessions", "no-owner", {allowed: true}],
    ["regular(none)", "audit:read-self", "own", {allowed: true}],
    ["regular(none)", "audit:read-self", "same-group-other", {allowed: true}],
    ["regular(none)", "audit:read-self", "other-group-other", {allowed: true}],
    ["regular(none)", "audit:read-self", "no-owner", {allowed: true}]
];

describe("AdminAuthorizer.authorize: 권한 매트릭스 전수", () => {
    it("주체 4종 x 대상 4종 x action 19종 = 304 조합을 모두 덮는다", () => {
        expect(MATRIX.length).toBe(304);
    });

    test.each(MATRIX)("%s / %s / %s", (principalName, action, targetName, expected) => {
        expect(authorize(PRINCIPALS[principalName], action, TARGETS[targetName])).toEqual(expected);
    });
});

describe("AdminAuthorizer.authorize: mustChangePassword 게이트", () => {
    const lockedSuperuser: Principal = {...PRINCIPALS["superuser"], mustChangePassword: true};

    it("server:manage 를 403 password_change_required 로 막는다", () => {
        expect(authorize(lockedSuperuser, "server:manage")).toEqual({allowed: false, status: 403, code: "password_change_required"});
    });

    it("me:password 와 me:read 만 통과시킨다", () => {
        expect(authorize(lockedSuperuser, "me:password")).toEqual({allowed: true});
        expect(authorize(lockedSuperuser, "me:read")).toEqual({allowed: true});
        expect(authorize(lockedSuperuser, "me:sessions")).toEqual({allowed: false, status: 403, code: "password_change_required"});
    });
});

describe("AdminAuthorizer.authorize: max_tunnel_count", () => {
    it("full 이어도 max_tunnel_count 가 0 이면 tunnel:create 가 403 tunnel_create_forbidden 이다", () => {
        const principal: Principal = {
            ...PRINCIPALS["regular(full,private)"],
            attributes: attributesOf({tunnel_crud: "full", max_tunnel_count: 0})
        };
        expect(authorize(principal, "tunnel:create")).toEqual({allowed: false, status: 403, code: "tunnel_create_forbidden"});
    });
});

describe("AdminAuthorizer.sections", () => {
    it("슈퍼유저는 9개 섹션을 정해진 순서로 돌려준다", () => {
        expect(sections(PRINCIPALS["superuser"])).toEqual(["status", "tunnels", "server", "users", "groups", "security", "audit", "sessions", "me"]);
    });

    it("일반 유저는 admin_ui_section_access 순서를 그대로 사상한다", () => {
        const access: AdminUiSection[] = ["my_profile", "tunnels"];
        const principal: Principal = {
            ...PRINCIPALS["regular(full,private)"],
            attributes: attributesOf({tunnel_crud: "full", admin_ui_section_access: access})
        };
        expect(sections(principal)).toEqual(["me", "tunnels"]);
    });

    it("tunnel_crud 가 none 이면 tunnels 섹션을 뺀다", () => {
        const access: AdminUiSection[] = ["my_profile", "tunnels"];
        const principal: Principal = {
            ...PRINCIPALS["regular(none)"],
            attributes: attributesOf({tunnel_crud: "none", admin_ui_section_access: access})
        };
        expect(sections(principal)).toEqual(["me"]);
    });
});

describe("AdminAuthorizer 성능 (NFR-PERF-PERMCHECK-001)", () => {
    it("authorize 10,000 회 호출의 p95 가 0.2ms 이하다", () => {
        const principal = PRINCIPALS["regular(full,private)"];
        const target: Target = {port: 1, owner: {userId: "x", groupId: "g"}};

        for(let i = 0; i < 1_000; i++) {
            authorize(principal, "tunnel:read", target);
        }

        const samples: number[] = new Array(10_000);
        for(let i = 0; i < 10_000; i++) {
            const started = process.hrtime.bigint();
            authorize(principal, "tunnel:read", target);
            samples[i] = Number(process.hrtime.bigint() - started) / 1_000_000;
        }

        samples.sort((left, right) => left - right);
        const p95 = samples[Math.floor(samples.length * 0.95)];
        expect(p95).toBeLessThanOrEqual(0.2);
    });
});

describe("AdminAuthorizer me:mfa (#112 U4-04)", () => {
    it("슈퍼유저와 일반 유저 모두 me:mfa 가 허용이다", () => {
        for(const name of Object.keys(PRINCIPALS)) {
            expect({name, decision: authorize(PRINCIPALS[name], "me:mfa")}).toEqual({name, decision: {allowed: true}});
        }
    });

    it("mustChangePassword 인 주체는 비밀번호 게이트가 먼저라 403 password_change_required 다", () => {
        for(const name of ["superuser", "regular(full,private)"]) {
            const principal: Principal = {...PRINCIPALS[name], mustChangePassword: true};
            expect(authorize(principal, "me:mfa")).toEqual({allowed: false, status: 403, code: "password_change_required"});
        }
    });
});
