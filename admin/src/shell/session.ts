import {getContext, setContext} from 'svelte';

export type SessionContext = {invalidate(): void};

const KEY = 'tttgate:session';

export const provideSession = (ctx: SessionContext) => setContext(KEY, ctx);

// 컴포넌트 초기화 중에만 부른다. 컨텍스트가 없는 fixture 에서는 아무 일도 하지 않는다.
export const useSession = (): SessionContext => getContext<SessionContext | undefined>(KEY) ?? {invalidate() {}};
