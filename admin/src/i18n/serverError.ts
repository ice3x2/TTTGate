import {i18n, PLACEHOLDER, type Translator} from './index';
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

/**
 * code 가 리소스에 있으면 그 언어의 문구다. 문구에 들어갈 값은 응답의 같은 이름 필드에서 받는다.
 * 리소스에 없는 code(서버와 화면의 버전이 다른 경우), 값 필드가 빠진 응답, code 가 없는 응답은 서버 문구를 그대로 보인다(AC-4).
 * 서버 문구가 없거나 AdminRequest 가 만든 문구면 fallback 이다. fallback 을 생략하면 실패 값의 문구(AdminRequest 가 만든 문구 포함)다.
 * 다만 서버가 응답했는데(status > 0) 문구가 없거나 JSON 이 깨져 AdminRequest 가 HTTP 상태 문구를 만들었으면 그 문구다.
 * 화면의 fallback 은 대개 '서버에 연결하지 못했다' 라서, 응답을 받은 실패에 쓰면 틀린 말이 된다.
 */
export function errorMessageOf(result: FailureLike, fallback: string = result.message ?? '', tr: Translator = i18n()): string {
    const key = typeof result.code === 'string' ? `serverError.${result.code}` : '';
    if(tr.has(key)) {
        const template = tr.t(key);
        const values = valuesOf(result, tr);
        const complete = [...template.matchAll(PLACEHOLDER)].every(([, name]) => Object.hasOwn(values, name));
        if(complete) return tr.t(key, values);
    }
    const responded = result.generated === true && typeof result.status === 'number' && result.status > 0;
    return serverMessageOf(result) || (responded ? result.message ?? fallback : fallback);
}
