import {i18n, type Translator} from '../../i18n';

// 이슈 349 FR-12 — 감사 이벤트 코드(type)의 화면 이름. 이름은 리소스의 auditEvent.<code> 다.
// 번역 맵에 없는 코드(서버와 화면의 버전이 다른 경우)는 이름이 없고, 화면은 코드 값만 보인다. 저장된 summary·detail 은 번역하지 않는다.

/** 이벤트 코드의 이름. 번역 맵에 없으면 undefined 다. */
export function auditEventName(code: string, tr: Translator = i18n()): string | undefined {
    const key = `auditEvent.${code}`;
    return tr.has(key) ? tr.t(key) : undefined;
}

/** 종류 선택 목록(#audit-filter-type)의 항목. 값은 코드이고, 글자는 '이름 (코드)' 다. 이름이 없으면 코드다. */
export function auditTypeOption(code: string, tr: Translator = i18n()): {value: string; label: string} {
    const name = auditEventName(code, tr);
    return {value: code, label: name === undefined ? code : tr.t('audit.typeOption', {name, code})};
}
