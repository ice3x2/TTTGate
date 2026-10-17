import {writable, type Writable} from 'svelte/store';
import {adminRequest} from './controller/AdminRequest';

// #102 (U2-10): 로그인한 주체의 프로필·볼 수 있는 섹션. 화면은 이 스토어로 내비게이션을 거른다.

export type Me = {
    user: {
        id: string; username: string; displayName: string; role: 'superuser' | 'regular'; status: string;
        groupId: string; groupName: string; mustChangePassword: boolean; migratedFromLegacyAdmin: boolean;
        createdAt: number; updatedAt: number;
    };
    group: {id: string; name: string; attributes: Record<string, unknown>};
    sections: string[];
    migrationBanner: boolean;
};

export const me: Writable<Me | undefined> = writable(undefined);

/**
 * GET /api/me 결과를 스토어에 싣고 돌려준다. 네트워크 오류 등으로 읽지 못하면 undefined(App 이 'Offline' 으로 보낸다).
 * 401 은 다른 컨트롤러와 같이 adminRequest 가 InvalidSession 으로 알린다.
 */
export async function loadMe(): Promise<Me | undefined> {
    const result = await adminRequest('/api/me');
    if(result.success !== true) return undefined;
    const value: Me = {user: result.user, group: result.group, sections: result.sections, migrationBanner: result.migrationBanner};
    me.set(value);
    return value;
}

export function clearMe(): void {
    me.set(undefined);
}
