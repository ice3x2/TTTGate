import * as crypto from "crypto";

export type Role = 'superuser' | 'regular';
export type UserStatus = 'active' | 'disabled';
export type TunnelCrud = 'none' | 'read_only' | 'full';
export type AllowedProtocol = 'TCP' | 'HTTP' | 'HTTPS' | 'HTTP_REWRITE';
export type AdminUiSection = 'tunnels' | 'my_audit' | 'my_profile' | 'my_sessions';
export type TunnelVisibility = 'private' | 'group_read';
export type RateLimitPreset = 'unlimited' | '1MB/s' | '10MB/s' | '100MB/s';
export type PortRange = {from: number; to: number};
export type RewritePermissions = {cors: boolean; host: boolean; header: boolean; body: boolean};

export type GroupAttributes = {
    tunnel_crud: TunnelCrud;
    max_tunnel_count: number;
    max_tunnel_duration_ms: number;
    allowed_port_range: PortRange[];
    allowed_protocols: AllowedProtocol[];
    max_concurrent_connections: number;
    allowed_trusted_clients: string[];
    http_tunnel_rewrite_permissions: RewritePermissions;
    admin_ui_section_access: AdminUiSection[];
    tunnel_visibility: TunnelVisibility;
    rate_limit: RateLimitPreset;
};

export type User = {
    id: string;
    username: string;
    displayName: string;
    role: Role;
    status: UserStatus;
    groupId: string;
    passwordHash: string;
    mustChangePassword: boolean;
    migratedFromLegacyAdmin: boolean;
    migrationAcknowledged: boolean;
    createdAt: number;
    updatedAt: number;
};

export type Group = {id: string; name: string; system: boolean; attributes: GroupAttributes};

export type IdentityFile = {version: 1; users: User[]; groups: Group[]};

export const IDENTITY_FILE_NAME = 'identity.yaml';
export const IDENTITY_SCHEMA_VERSION = 1;
export const SYSTEM_SUPERUSER_GROUP_ID = 'system:superuser';
export const DEFAULT_GROUP_ID = 'default';
export const MIGRATED_OWNER_ID = 'system:migrated';
export const MIN_PASSWORD_LENGTH = 8;

const ALLOWED_PROTOCOLS: readonly AllowedProtocol[] = ['TCP', 'HTTP', 'HTTPS', 'HTTP_REWRITE'];
const ADMIN_UI_SECTIONS: readonly AdminUiSection[] = ['tunnels', 'my_audit', 'my_profile', 'my_sessions'];
const TUNNEL_CRUD_VALUES: readonly TunnelCrud[] = ['none', 'read_only', 'full'];
const TUNNEL_VISIBILITY_VALUES: readonly TunnelVisibility[] = ['private', 'group_read'];
const RATE_LIMIT_VALUES: readonly RateLimitPreset[] = ['unlimited', '1MB/s', '10MB/s', '100MB/s'];
const GROUP_ATTRIBUTE_KEYS: readonly string[] = [
    'tunnel_crud', 'max_tunnel_count', 'max_tunnel_duration_ms', 'allowed_port_range',
    'allowed_protocols', 'max_concurrent_connections', 'allowed_trusted_clients',
    'http_tunnel_rewrite_permissions', 'admin_ui_section_access', 'tunnel_visibility', 'rate_limit'
];

export const DEFAULT_GROUP_ATTRIBUTES: Readonly<GroupAttributes> = {
    tunnel_crud: 'full',
    max_tunnel_count: 10,
    max_tunnel_duration_ms: 0,
    allowed_port_range: [],
    allowed_protocols: [],
    max_concurrent_connections: 100,
    allowed_trusted_clients: [],
    http_tunnel_rewrite_permissions: {cors: false, host: false, header: false, body: false},
    admin_ui_section_access: [...ADMIN_UI_SECTIONS],
    tunnel_visibility: 'private',
    rate_limit: 'unlimited'
};

/**
 * GroupAttributes 값을 깊은 복사한다. 배열·중첩 객체 필드를 각각 새로 만들어
 * 반환값과 원본이 참조를 공유하지 않도록 한다(불변 객체 + 참조 교체 원칙).
 */
export function cloneGroupAttributes(attributes: GroupAttributes): GroupAttributes {
    return {
        ...attributes,
        allowed_port_range: attributes.allowed_port_range.map((range) => ({...range})),
        allowed_protocols: [...attributes.allowed_protocols],
        allowed_trusted_clients: [...attributes.allowed_trusted_clients],
        admin_ui_section_access: [...attributes.admin_ui_section_access],
        http_tunnel_rewrite_permissions: {...attributes.http_tunnel_rewrite_permissions}
    };
}

export type Result<T> = {success: true; value: T} | {success: false; status: 404 | 409 | 422; code: string; message: string};
export type ValidationFailure = {success: false; status: 422; code: string; message: string};

function invalid(code: string, message: string): ValidationFailure {
    return {success: false, status: 422, code, message};
}

export function validateUsername(value: unknown): {success: true; value: string} | ValidationFailure {
    if(typeof value !== 'string') {
        return invalid('username_invalid', 'username must be a string');
    }
    const normalized = value.trim().toLowerCase();
    if(normalized.length < 3 || normalized.length > 32 || !/^[a-z0-9._-]+$/.test(normalized)) {
        return invalid('username_invalid', `username is invalid: ${value}`);
    }
    return {success: true, value: normalized};
}

export function validateDisplayName(value: unknown): {success: true; value: string} | ValidationFailure {
    if(typeof value !== 'string') {
        return invalid('display_name_invalid', 'displayName must be a string');
    }
    const normalized = value.trim();
    if(normalized.length < 1 || normalized.length > 64) {
        return invalid('display_name_invalid', `displayName is invalid: ${value}`);
    }
    return {success: true, value: normalized};
}

export function validatePassword(value: unknown): {success: true; value: string} | ValidationFailure {
    if(typeof value !== 'string' || value.trim().length < MIN_PASSWORD_LENGTH) {
        return invalid('password_too_short', `password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    return {success: true, value: value.trim()};
}

function isNonNegativeInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isValidPortRange(range: unknown): range is PortRange {
    if(typeof range !== 'object' || range === null) {
        return false;
    }
    const {from, to} = range as PortRange;
    return Number.isInteger(from) && Number.isInteger(to)
        && from >= 1 && from <= 65535 && to >= 1 && to <= 65535 && from <= to;
}

function isRewritePermissionsShape(value: unknown): value is RewritePermissions {
    if(typeof value !== 'object' || value === null) {
        return false;
    }
    const keys = Object.keys(value);
    if(keys.length !== 4) {
        return false;
    }
    return ['cors', 'host', 'header', 'body'].every((key) => typeof (value as Record<string, unknown>)[key] === 'boolean');
}

export function validateGroupAttributes(patch: unknown, base: GroupAttributes): {success: true; value: GroupAttributes} | ValidationFailure {
    if(typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
        return invalid('attributes_invalid', 'attributes patch must be an object');
    }
    const patchObject = patch as Record<string, unknown>;
    for(const key of Object.keys(patchObject)) {
        if(!GROUP_ATTRIBUTE_KEYS.includes(key)) {
            return invalid('attributes_unknown_key', `unknown group attribute: ${key}`);
        }
    }

    const merged: Record<string, unknown> = {...base, ...patchObject};

    if(!TUNNEL_CRUD_VALUES.includes(merged.tunnel_crud as TunnelCrud)) {
        return invalid('attribute_enum_invalid', `invalid tunnel_crud: ${merged.tunnel_crud}`);
    }
    if(!isNonNegativeInt(merged.max_tunnel_count)) {
        return invalid('attribute_int_invalid', `invalid max_tunnel_count: ${merged.max_tunnel_count}`);
    }
    if(!isNonNegativeInt(merged.max_tunnel_duration_ms)) {
        return invalid('attribute_int_invalid', `invalid max_tunnel_duration_ms: ${merged.max_tunnel_duration_ms}`);
    }
    if(!Array.isArray(merged.allowed_port_range) || !merged.allowed_port_range.every(isValidPortRange)) {
        return invalid('port_range_invalid', 'invalid allowed_port_range');
    }
    if(!Array.isArray(merged.allowed_protocols) || !merged.allowed_protocols.every((protocol) => ALLOWED_PROTOCOLS.includes(protocol as AllowedProtocol))) {
        return invalid('attribute_enum_invalid', 'invalid allowed_protocols');
    }
    if(!isNonNegativeInt(merged.max_concurrent_connections)) {
        return invalid('attribute_int_invalid', `invalid max_concurrent_connections: ${merged.max_concurrent_connections}`);
    }
    if(!Array.isArray(merged.allowed_trusted_clients)
        || !merged.allowed_trusted_clients.every((client) => typeof client === 'string' && client.length > 0 && client !== '*')) {
        return invalid('trusted_clients_invalid', 'invalid allowed_trusted_clients');
    }
    if(!isRewritePermissionsShape(merged.http_tunnel_rewrite_permissions)) {
        return invalid('rewrite_permissions_invalid', 'invalid http_tunnel_rewrite_permissions');
    }
    if(!Array.isArray(merged.admin_ui_section_access)
        || !merged.admin_ui_section_access.every((section) => ADMIN_UI_SECTIONS.includes(section as AdminUiSection))) {
        return invalid('attribute_enum_invalid', 'invalid admin_ui_section_access');
    }
    if(!TUNNEL_VISIBILITY_VALUES.includes(merged.tunnel_visibility as TunnelVisibility)) {
        return invalid('attribute_enum_invalid', `invalid tunnel_visibility: ${merged.tunnel_visibility}`);
    }
    if(!RATE_LIMIT_VALUES.includes(merged.rate_limit as RateLimitPreset)) {
        return invalid('attribute_enum_invalid', `invalid rate_limit: ${merged.rate_limit}`);
    }

    const protocols = merged.allowed_protocols as AllowedProtocol[];
    const rewritePermissions = merged.http_tunnel_rewrite_permissions as RewritePermissions;
    const anyRewriteEnabled = rewritePermissions.cors || rewritePermissions.host || rewritePermissions.header || rewritePermissions.body;
    if(anyRewriteEnabled && !protocols.includes('HTTP_REWRITE')) {
        return invalid('rewrite_requires_http_rewrite', 'http_tunnel_rewrite_permissions requires HTTP_REWRITE in allowed_protocols');
    }
    if(protocols.includes('HTTP_REWRITE') && !protocols.includes('HTTP') && !protocols.includes('HTTPS')) {
        return invalid('http_rewrite_requires_http', 'HTTP_REWRITE requires HTTP or HTTPS in allowed_protocols');
    }

    return {
        success: true,
        value: {
            tunnel_crud: merged.tunnel_crud as TunnelCrud,
            max_tunnel_count: merged.max_tunnel_count as number,
            max_tunnel_duration_ms: merged.max_tunnel_duration_ms as number,
            allowed_port_range: (merged.allowed_port_range as PortRange[]).map((range) => ({...range})),
            allowed_protocols: [...protocols],
            max_concurrent_connections: merged.max_concurrent_connections as number,
            allowed_trusted_clients: [...(merged.allowed_trusted_clients as string[])],
            http_tunnel_rewrite_permissions: {...rewritePermissions},
            admin_ui_section_access: [...(merged.admin_ui_section_access as AdminUiSection[])],
            tunnel_visibility: merged.tunnel_visibility as TunnelVisibility,
            rate_limit: merged.rate_limit as RateLimitPreset
        }
    };
}

export function newUserId(): string {
    return `u_${crypto.randomBytes(8).toString('hex')}`;
}

export function newGroupId(): string {
    return `g_${crypto.randomBytes(8).toString('hex')}`;
}

export function createSystemGroups(): [Group, Group] {
    return [
        {id: SYSTEM_SUPERUSER_GROUP_ID, name: 'Superusers', system: true, attributes: cloneGroupAttributes(DEFAULT_GROUP_ATTRIBUTES)},
        {id: DEFAULT_GROUP_ID, name: 'Default', system: true, attributes: cloneGroupAttributes(DEFAULT_GROUP_ATTRIBUTES)}
    ];
}

export function isBcryptHash(hash: string): boolean {
    return /^\$2[aby]\$\d{2}\$/.test(hash);
}
