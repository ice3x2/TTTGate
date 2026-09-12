import type {Route, Screen} from '../router';

export const NAV: ReadonlyArray<{hash: string; title: string; screen: Screen}> = [
    {hash: '#/status',  title: 'Status',          screen: 'status'},
    {hash: '#/tunnels', title: 'Tunnels',         screen: 'tunnels'},
    {hash: '#/server',  title: 'Server settings',  screen: 'server'},
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
