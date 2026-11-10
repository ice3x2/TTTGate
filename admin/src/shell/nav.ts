import type {Route, Screen} from '../router';
import {i18n, type MessageKey, type Translator} from '../i18n';

// U3-01: section 은 서버 /api/me 의 sections 값이다. 드로어와 라우트 가드가 같은 표를 쓴다.
export type Section = 'status' | 'tunnels' | 'server' | 'users' | 'groups' | 'security' | 'audit' | 'sessions' | 'me';
/** NAV 의 항목. 제목은 리소스 키다(이슈 349). 화면에 그릴 때 visibleNav 가 정한 언어의 제목을 붙인다. */
export type NavEntry = {hash: string; titleKey: MessageKey; screen: Screen; section: Section};
export type NavItem = NavEntry & {title: string};

// 이슈 338: 로그인하면 터널 목록이 먼저 보인다. 그래서 Tunnels 가 첫 항목이고 defaultHash 의 첫 후보다.
export const NAV: ReadonlyArray<NavEntry> = [
    {hash: '#/tunnels', titleKey: 'nav.tunnels',        screen: 'tunnels', section: 'tunnels'},
    {hash: '#/status',  titleKey: 'nav.status',         screen: 'status',  section: 'status'},
    {hash: '#/server',  titleKey: 'nav.serverSettings', screen: 'server',  section: 'server'},
    // #213: 신뢰 클라이언트 관리. 자격 증명을 만드는 화면이라 서버 설정과 같은 섹션(server:manage)이다.
    {hash: '#/clients', titleKey: 'nav.trustedClients', screen: 'clients', section: 'server'},
    {hash: '#/users',   titleKey: 'nav.users',          screen: 'users',   section: 'users'},
    {hash: '#/groups',  titleKey: 'nav.groups',         screen: 'groups',  section: 'groups'},
    {hash: '#/security', titleKey: 'nav.security',      screen: 'security', section: 'security'},
    {hash: '#/audit',    titleKey: 'nav.auditLog',      screen: 'audit',    section: 'audit'},
    {hash: '#/sessions', titleKey: 'nav.sessions',      screen: 'sessions', section: 'sessions'},
    {hash: '#/me',      titleKey: 'nav.myAccount',      screen: 'me',      section: 'me'},
];

/** 화면이 속한 섹션. null 은 누구에게나 허용된다. */
export const SECTION_OF_SCREEN: Record<Screen, Section | null> = {
    status: 'status', tunnels: 'tunnels', 'tunnel-edit': 'tunnels', server: 'server',
    users: 'users', 'user-edit': 'users', groups: 'groups', 'group-edit': 'groups',
    me: 'me', 'me-password': null, denied: null,
    audit: 'audit', sessions: 'sessions', security: 'security', clients: 'server',
};

export function visibleNav(sections: string[], tr: Translator = i18n()): NavItem[] {
    return NAV.filter((item) => sections.includes(item.section)).map((item) => ({...item, title: tr.t(item.titleKey)}));
}

export function defaultHash(sections: string[]): string {
    return visibleNav(sections)[0]?.hash ?? '#/me';
}

/** 사용자가 고르지 않은 기본 해시. 권한이 없으면 #/denied 가 아니라 defaultHash 로 보낸다(이슈 338). */
const DEFAULT_HASHES: ReadonlySet<string> = new Set(['', '#', '#/', '#/status', '#/tunnels']);
export function isDefaultHash(hash: string): boolean {
    return DEFAULT_HASHES.has(hash);
}

export function chrome(route: Route, tr: Translator = i18n()): {title: string; back?: string} {
    switch(route.screen) {
        case 'tunnel-edit': return {title: route.param === 'new' ? tr.t('nav.newTunnel') : tr.t('nav.tunnel', {port: String(route.param)}), back: '#/tunnels'};
        case 'user-edit': return {title: tr.t(route.param === 'new' ? 'nav.newUser' : 'nav.user'), back: '#/users'};
        case 'group-edit': return {title: tr.t(route.param === 'new' ? 'nav.newGroup' : 'nav.group'), back: '#/groups'};
        case 'me-password': return {title: tr.t('nav.changePassword'), back: '#/me'};
        case 'denied': return {title: tr.t('nav.noAccess')};
        // U4-06: 역할과 무관한 기본 제목이다. 일반 유저의 "My activity" 는 App 이 덮는다.
        case 'audit': return {title: tr.t('nav.auditLog')};
        case 'sessions': return {title: tr.t('nav.sessions')};
        case 'security': return {title: tr.t('nav.security')};
    }
    const item = NAV.find((entry) => entry.screen === route.screen);
    return {title: tr.t(item ? item.titleKey : 'nav.status')};
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
