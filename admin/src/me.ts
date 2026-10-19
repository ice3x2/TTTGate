import {writable, type Writable} from 'svelte/store';
import MeCtrl from './controller/MeCtrl';
import type {MeResponse} from './controller/Types';

// U2-10: 로그인한 주체의 프로필·볼 수 있는 섹션. 화면은 이 스토어로 내비게이션과 라우트를 거른다.
// U3-01: 타입은 controller/Types.ts 의 MeResponse, 요청은 MeCtrl 이 한다.

export type Me = MeResponse;

export const me: Writable<Me | undefined> = writable(undefined);

/**
 * GET /api/me 결과를 스토어에 싣고 돌려준다. 401 이 아닌 실패(네트워크 오류 등)는 undefined 이고 App 이 'Offline' 으로 보낸다.
 * 401 은 다른 컨트롤러와 같이 adminRequest 가 InvalidSession 으로 알린다.
 * 실패해도 이미 실린 me 는 지우지 않는다. 처음 읽기는 App 이 clearMe 로 먼저 비우고, 다시 읽기(U3-02)가 실패했을 때
 * 화면 전체가 Loading 으로 바뀌지 않게 한다.
 */
export async function loadMe(): Promise<Me | undefined> {
    const result = await MeCtrl.instance.me();
    if(result.success !== true) return undefined;
    const value: Me = {user: result.user, group: result.group, sections: result.sections, migrationBanner: result.migrationBanner,
        mfa: result.mfa, mustEnrollMfa: result.mustEnrollMfa === true};
    me.set(value);
    return value;
}

export function clearMe(): void {
    me.set(undefined);
}
