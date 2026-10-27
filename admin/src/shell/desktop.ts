import {readable} from 'svelte/store';

/** 이 폭 이상이면 데스크탑으로 보고 서랍 메뉴를 왼쪽에 늘 열어 둔다(이슈 278). */
const DESKTOP_QUERY = '(min-width: 1024px)';

/** 화면 폭이 데스크탑 기준 이상인지. 창 크기가 바뀌면 바로 따라간다. */
export const isDesktop = readable(false, (set) => {
    const query = window.matchMedia(DESKTOP_QUERY);
    set(query.matches);
    const onChange = (e: MediaQueryListEvent) => set(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
});
