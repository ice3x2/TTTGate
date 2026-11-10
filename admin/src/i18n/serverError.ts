import {i18n, PLACEHOLDER, type MessageKey, type Translator} from './index';
import {serverMessageOf} from '../controller/AdminRequest';

// 이슈 349 FR-7 — 서버 실패 응답을 화면 문구로 바꾸는 하나의 함수. 코드별 문구는 리소스의 serverError.<code> 다.

type FailureLike = {code?: unknown; message?: string; generated?: boolean; [field: string]: unknown};

const isTextValue = (value: unknown): value is string | number => typeof value === 'string' || typeof value === 'number';

/** 응답의 값 필드 가운데 문구에 끼울 수 있는 것. 문자열·숫자는 그대로, 비어 있지 않은 문자열·숫자의 배열은 그 언어의 목록 표기로 잇는다. */
const valuesOf = (result: FailureLike, tr: Translator): Record<string, string | number> => {
    const values: Record<string, string | number> = {};
    for(const [name, value] of Object.entries(result)) {
        if(isTextValue(value)) values[name] = value;
        else if(Array.isArray(value) && value.length > 0 && value.every(isTextValue)) values[name] = tr.list(value);
    }
    return values;
};

/** 다른 키의 문구를 그대로 쓰는 code. 같은 문구를 두 키에 두면 한쪽만 고쳐질 수 있다(검토 L-3). */
const SHARED_KEYS: Readonly<Record<string, MessageKey>> = {
    login_failed: 'serverError.password_incorrect',
};

/** code 의 문구 키. 다른 키의 문구를 쓰는 code 면 그 키, 아니면 serverError.<code> 다. 문구가 없는 code 면 undefined 다. */
export function serverErrorKeyOf(code: string, tr: Translator = i18n()): MessageKey | undefined {
    if(Object.hasOwn(SHARED_KEYS, code)) return SHARED_KEYS[code];
    const key = `serverError.${code}`;
    return tr.has(key) ? key : undefined;
}

/**
 * code 가 리소스에 있으면 그 언어의 문구다. 문구에 들어갈 값은 응답의 같은 이름 필드에서 받는다.
 * 리소스에 없는 code(서버와 화면의 버전이 다른 경우), 값 필드가 빠진 응답, code 가 없는 응답은 서버 문구를 그대로 보인다(AC-4).
 * 서버 문구가 없거나 AdminRequest 가 만든 문구면 fallback 이다. 화면이 넘긴 fallback(예: '터널을 바꾸지 못했다')은 그대로 보인다.
 * fallback 을 생략하면 일반 문구다. 서버가 응답했으면(status > 0) AdminRequest 가 만든 HTTP 상태 문구, 서버에 닿지 못했거나
 * 보일 문구가 없으면 '서버에 연결하지 못했다' 다. 응답을 받은 실패에 '연결하지 못했다' 는 틀린 말이고(검토 L-5),
 * 네트워크 실패의 예외 원문(Failed to fetch 등)은 보이지 않는다(검토 H-1).
 */
export function errorMessageOf(result: FailureLike, fallback?: string, tr: Translator = i18n()): string {
    const key = typeof result.code === 'string' ? serverErrorKeyOf(result.code, tr) : undefined;
    if(key !== undefined) {
        const template = tr.t(key);
        const values = valuesOf(result, tr);
        const complete = [...template.matchAll(PLACEHOLDER)].every(([, name]) => Object.hasOwn(values, name));
        if(complete) return tr.t(key, values);
    }
    const serverText = serverMessageOf(result);
    if(serverText) return serverText;
    if(fallback !== undefined) return fallback;
    const responded = result.generated === true && typeof result.status === 'number' && result.status > 0;
    return responded && result.message ? result.message : tr.t('common.unableToConnect');
}
