// 해시 라우터. Jest(ts-jest, CommonJS)가 parseHash 를 import 하므로 이 파일은 아무것도 import 하지 않는다.

export type Screen = 'status' | 'tunnels' | 'tunnel-edit' | 'server'
    | 'users' | 'user-edit' | 'groups' | 'group-edit' | 'me' | 'me-password' | 'denied' | 'audit' | 'sessions';
export type Route = {screen: Screen; param?: string};

type Subscriber = (value: Route) => void;

const isPort = (value: string): boolean => /^[1-9][0-9]{0,4}$/.test(value) && Number(value) <= 65535;
// U3-01: 사용자·그룹 id 형식. 시스템 그룹 두 개는 고정 이름이다.
const isUserId = (value: string): boolean => /^u_[0-9a-f]{16}$/.test(value);
const isGroupId = (value: string): boolean => /^g_[0-9a-f]{16}$/.test(value) || value === 'default' || value === 'system:superuser';

export function parseHash(hash: string): Route {
    const segments = (hash.startsWith('#') ? hash.slice(1) : hash).split('/').filter((segment) => segment.length > 0);
    if(segments.length === 1) {
        if(segments[0] === 'tunnels') return {screen: 'tunnels'};
        if(segments[0] === 'server') return {screen: 'server'};
        if(segments[0] === 'users') return {screen: 'users'};
        if(segments[0] === 'groups') return {screen: 'groups'};
        if(segments[0] === 'me') return {screen: 'me'};
        if(segments[0] === 'denied') return {screen: 'denied'};
        if(segments[0] === 'audit') return {screen: 'audit'};
        if(segments[0] === 'sessions') return {screen: 'sessions'};
    }
    if(segments.length === 2 && segments[0] === 'tunnels') {
        if(segments[1] === 'new' || isPort(segments[1])) return {screen: 'tunnel-edit', param: segments[1]};
        return {screen: 'tunnels'};
    }
    if(segments.length === 2 && segments[0] === 'users') {
        if(segments[1] === 'new' || isUserId(segments[1])) return {screen: 'user-edit', param: segments[1]};
        return {screen: 'users'};
    }
    if(segments.length === 2 && segments[0] === 'groups') {
        if(segments[1] === 'new' || isGroupId(segments[1])) return {screen: 'group-edit', param: segments[1]};
        return {screen: 'groups'};
    }
    if(segments.length === 2 && segments[0] === 'me' && segments[1] === 'password') return {screen: 'me-password'};
    return {screen: 'status'};
}

const subscribers = new Set<Subscriber>();
let current: Route = typeof window === 'undefined' ? {screen: 'status'} : parseHash(window.location.hash);

if(typeof window !== 'undefined') {
    window.addEventListener('hashchange', () => {
        current = parseHash(window.location.hash);
        for(const run of subscribers) run(current);
    });
}

// Svelte store 계약(subscribe 즉시 호출 + 해제 함수 반환)만 맞춘 자체 구현.
export const route = {
    subscribe(run: Subscriber): () => void {
        subscribers.add(run);
        run(current);
        return () => { subscribers.delete(run); };
    },
};

export function navigate(hash: string): void {
    window.location.hash = hash;
}
