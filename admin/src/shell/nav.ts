import type {Route, Screen} from '../router';

// U3-01: section 은 서버 /api/me 의 sections 값이다. 드로어와 라우트 가드가 같은 표를 쓴다.
export type Section = 'status' | 'tunnels' | 'server' | 'users' | 'groups' | 'security' | 'audit' | 'sessions' | 'me';
export type NavItem = {hash: string; title: string; screen: Screen; section: Section};

export const NAV: ReadonlyArray<NavItem> = [
    {hash: '#/status',  title: 'Status',          screen: 'status',  section: 'status'},
    {hash: '#/tunnels', title: 'Tunnels',         screen: 'tunnels', section: 'tunnels'},
    {hash: '#/server',  title: 'Server settings', screen: 'server',  section: 'server'},
    {hash: '#/users',   title: 'Users',           screen: 'users',   section: 'users'},
    {hash: '#/groups',  title: 'Groups',          screen: 'groups',  section: 'groups'},
    // 단위 5 가 이 앞에 Security 를 넣는다
    {hash: '#/audit',    title: 'Audit log',  screen: 'audit',    section: 'audit'},
    {hash: '#/sessions', title: 'Sessions',   screen: 'sessions', section: 'sessions'},
    {hash: '#/me',      title: 'My account',      screen: 'me',      section: 'me'},
];

/** 화면이 속한 섹션. null 은 누구에게나 허용된다. */
export const SECTION_OF_SCREEN: Record<Screen, Section | null> = {
    status: 'status', tunnels: 'tunnels', 'tunnel-edit': 'tunnels', server: 'server',
    users: 'users', 'user-edit': 'users', groups: 'groups', 'group-edit': 'groups',
    me: 'me', 'me-password': null, denied: null,
    audit: 'audit', sessions: 'sessions',
};

export function visibleNav(sections: string[]): NavItem[] {
    return NAV.filter((item) => sections.includes(item.section));
}

export function defaultHash(sections: string[]): string {
    return visibleNav(sections)[0]?.hash ?? '#/me';
}

export function chrome(route: Route): {title: string; back?: string} {
    switch(route.screen) {
        case 'tunnel-edit': return {title: route.param === 'new' ? 'New tunnel' : `Tunnel ${route.param}`, back: '#/tunnels'};
        case 'user-edit': return {title: route.param === 'new' ? 'New user' : 'User', back: '#/users'};
        case 'group-edit': return {title: route.param === 'new' ? 'New group' : 'Group', back: '#/groups'};
        case 'me-password': return {title: 'Change password', back: '#/me'};
        case 'denied': return {title: 'No access'};
        // U4-06: 역할과 무관한 기본 제목이다. 일반 유저의 "My activity" 는 App 이 덮는다.
        case 'audit': return {title: 'Audit log'};
        case 'sessions': return {title: 'Sessions'};
    }
    const item = NAV.find((entry) => entry.screen === route.screen);
    return {title: item ? item.title : 'Status'};
}

// 드로어의 현재 항목 판정. 편집 화면은 목록 항목으로 묶인다.
export function navScreen(route: Route): Screen {
    switch(route.screen) {
        case 'tunnel-edit': return 'tunnels';
        case 'user-edit': return 'users';
        case 'group-edit': return 'groups';
        case 'me-password': return 'me';
        default: return route.screen;
    }
}
