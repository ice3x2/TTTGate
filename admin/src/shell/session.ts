import {getContext, setContext} from 'svelte';
import LoginCtrl from '../controller/LoginCtrl';
import {clearMe} from '../me';
import {navigate} from '../router';

export type SessionContext = {invalidate(): void};

const KEY = 'tttgate:session';

export const provideSession = (ctx: SessionContext) => setContext(KEY, ctx);

// 컴포넌트 초기화 중에만 부른다. 컨텍스트가 없는 fixture 에서는 아무 일도 하지 않는다.
export const useSession = (): SessionContext => getContext<SessionContext | undefined>(KEY) ?? {invalidate() {}};

/**
 * #102 (U2-10) Sign out. 서버 세션을 끝내고 me 를 비운 뒤 로그인 화면으로 보낸다.
 * 요청이 실패해도(이미 끊긴 세션의 401 포함) 화면 쪽 정리와 상태 전환은 한다.
 */
export async function signOut(ctx: SessionContext): Promise<void> {
    try { await LoginCtrl.logout(); } catch { /* 이미 끊긴 세션이면 InvalidSession 이 온다. 로그인 화면으로 가는 것은 같다 */ }
    clearMe();
    // 해시를 남기면 다음에 로그인한 다른 사용자가 권한 없는 화면에서 시작한다. 기본 화면으로 되돌린다.
    navigate('#/status');
    ctx.invalidate();
}
