import type {IdentityFixture} from './identityFixture';

// U3-01 / #103 — 단위 3 화면 테스트가 함께 쓰는 rbac fixture 값의 단일 출처. 드라이버(자식 프로세스)와 테스트가 같이 import 한다.
// 뒤 이슈들의 테스트가 이 값을 그대로 쓰므로 바꾸지 않는다.

export const RBAC_USER_IDS = {admin: 'u_0000000000000001', alice: 'u_0000000000000002', bob: 'u_0000000000000003',
    carol: 'u_0000000000000004', dave: 'u_0000000000000005'} as const;

export const RBAC_GROUP_FIELD_ID = 'g_0000000000000001';

export const RBAC_PASSWORDS = {admin: 'test-password-1234', alice: 'user-password-1234', bob: 'user-password-1234',
    carol: 'user-password-1234', dave: 'temp-password-1234'} as const;

export const RBAC_IDENTITY_FIXTURE: IdentityFixture = {
    users: [
        {id: RBAC_USER_IDS.admin, username: 'admin', displayName: 'Admin', role: 'superuser', mustChangePassword: false,
            password: RBAC_PASSWORDS.admin, migratedFromLegacyAdmin: true},
        {id: RBAC_USER_IDS.alice, username: 'alice', displayName: 'Alice', role: 'regular', groupId: RBAC_GROUP_FIELD_ID,
            mustChangePassword: false, password: RBAC_PASSWORDS.alice},
        {id: RBAC_USER_IDS.bob, username: 'bob', displayName: 'Bob', role: 'regular', groupId: RBAC_GROUP_FIELD_ID,
            mustChangePassword: false, password: RBAC_PASSWORDS.bob},
        {id: RBAC_USER_IDS.carol, username: 'carol', displayName: 'Carol', role: 'regular', groupId: 'default',
            mustChangePassword: false, password: RBAC_PASSWORDS.carol},
        {id: RBAC_USER_IDS.dave, username: 'dave', displayName: 'Dave', role: 'regular', groupId: RBAC_GROUP_FIELD_ID,
            mustChangePassword: true, password: RBAC_PASSWORDS.dave},
    ],
    groups: [{
        id: RBAC_GROUP_FIELD_ID, name: 'Field team',
        attributes: {
            tunnel_crud: 'full', max_tunnel_count: 2, max_tunnel_duration_ms: 0,
            allowed_port_range: [{from: 20000, to: 20099}], allowed_protocols: ['TCP', 'HTTP', 'HTTP_REWRITE'],
            max_concurrent_connections: 100, allowed_trusted_clients: ['client-a'],
            http_tunnel_rewrite_permissions: {cors: true, host: true, header: false, body: false},
            admin_ui_section_access: ['tunnels', 'my_audit', 'my_profile', 'my_sessions'],
            tunnel_visibility: 'group_read', rate_limit: 'unlimited'
        }
    }]
};

export const RBAC_TUNNELS: Array<{forwardPort: number; protocol: 'tcp' | 'http'; destinationAddress: string; destinationPort: number; ownerId?: string;
    allowedClientIds?: string[]}> = [
    {forwardPort: 20001, protocol: 'tcp', destinationAddress: '127.0.0.1', destinationPort: 8081, ownerId: RBAC_USER_IDS.alice},
    // #178: 슈퍼유저가 그룹 밖 id(client-b)를 넣어 둔 상태. bob 의 그룹은 client-a 만 허용한다.
    {forwardPort: 20002, protocol: 'http', destinationAddress: '127.0.0.1', destinationPort: 8082, ownerId: RBAC_USER_IDS.bob, allowedClientIds: ['client-b']},
    {forwardPort: 20003, protocol: 'tcp', destinationAddress: '127.0.0.1', destinationPort: 8083},
];

export const RBAC_TRUSTED_CLIENTS: Array<{clientId: string; clientSecret: string; displayName: string}> = [
    {clientId: 'client-a', clientSecret: 'client-a-secret-0123456789abcdef', displayName: 'Client A'},
    {clientId: 'client-b', clientSecret: 'client-b-secret-0123456789abcdef', displayName: 'Client B'},
];
