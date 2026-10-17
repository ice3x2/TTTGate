import type {Route, Screen} from '../router';

// #102 (U2-10): section 은 서버 /api/me 의 sections 값이다. 드로어는 주체가 볼 수 있는 항목만 그린다.
export type NavSection = 'status' | 'tunnels' | 'server';

export const NAV: ReadonlyArray<{hash: string; title: string; screen: Screen; section: NavSection}> = [
    {hash: '#/status',  title: 'Status',          screen: 'status',  section: 'status'},
    {hash: '#/tunnels', title: 'Tunnels',         screen: 'tunnels', section: 'tunnels'},
    {hash: '#/server',  title: 'Server settings', screen: 'server',  section: 'server'},
];

export function chrome(route: Route): {title: string; back?: string} {
    if(route.screen === 'tunnel-edit') {
        return {title: route.param === 'new' ? 'New tunnel' : `Tunnel ${route.param}`, back: '#/tunnels'};
    }
    const item = NAV.find((entry) => entry.screen === route.screen);
    return {title: item ? item.title : 'Status'};
}

// 드로어의 현재 항목 판정. 터널 편집은 터널 목록 항목으로 묶인다.
export function navScreen(route: Route): Screen {
    return route.screen === 'tunnel-edit' ? 'tunnels' : route.screen;
}
