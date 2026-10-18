// 해시 라우터. Jest(ts-jest, CommonJS)가 parseHash 를 import 하므로 이 파일은 아무것도 import 하지 않는다.

export type Screen = 'status' | 'tunnels' | 'tunnel-edit' | 'server'
    | 'users' | 'user-edit' | 'groups' | 'group-edit' | 'me' | 'me-password' | 'denied' | 'audit' | 'sessions' | 'security';
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
        if(segments[0] === 'security') return {screen: 'security'};
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
let currentHash = typeof window === 'undefined' ? '' : window.location.hash;
// 이동을 막는 화면(예: 한 번만 보이는 복구 코드)이 등록한다. false 를 돌려주면 hash 를 되돌리고 화면을 바꾸지 않는다.
let guard: (() => boolean) | undefined;

if(typeof window !== 'undefined') {
    window.addEventListener('hashchange', () => {
        if(guard && !guard()) {
            // hashchange 는 취소할 수 없다. 기록을 늘리지 않고 주소만 이전 hash 로 되돌린다.
            history.replaceState(history.state, '', currentHash || '#');
            return;
        }
        currentHash = window.location.hash;
        current = parseHash(window.location.hash);
        for(const run of subscribers) run(current);
    });
}

/**
 * 화면을 떠나지 못하게 막는다. 해제 함수를 돌려준다.
 * 새로고침·탭 닫기는 hashchange 로 막을 수 없으므로 브라우저 확인 창(beforeunload)도 함께 건다.
 */
export function blockNavigation(allow: () => boolean): () => void {
    guard = allow;
    const confirmUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', confirmUnload);
    return () => {
        window.removeEventListener('beforeunload', confirmUnload);
        if(guard === allow) guard = undefined;
    };
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
