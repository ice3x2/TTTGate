import {en, type MessageKey, type Messages} from './en';
import {ko} from './ko';

// 이슈 349 — 관리 화면의 문구와 언어. 외부 라이브러리를 쓰지 않는다(FR-1).
// 언어는 앱이 시작할 때 startI18n 이 한 번 정한다(main.ts 가 가장 먼저 불러오는 i18n/start.ts). 그 전의 기본값은 영어다.
// 모듈 최상위에서 t() 를 부르지 않는다. 언어가 정해지기 전에 평가될 수 있다. 문구는 쓰는 때에 만든다.
// 문구를 만드는 순수 함수는 Translator 를 마지막 인자로 받는다. 생략하면 앱의 언어다. 테스트는 translator('ko') 를 넘긴다.

export type {MessageKey, Messages};
export type Locale = 'en' | 'ko';
export type Params = Readonly<Record<string, string | number>>;
/** _one·_other 두 키를 모두 가진 복수형 문구의 이름. */
export type PluralKey = {[K in MessageKey]: K extends `${infer Base}_other` ? (`${Base}_one` extends MessageKey ? Base : never) : never}[MessageKey];

export type Translator = {
    readonly locale: Locale;
    /** Intl 에 넘기는 언어 태그. */
    readonly intl: string;
    t(key: MessageKey, params?: Params): string;
    /** 개수로 _one·_other 키를 고른다. {count} 는 개수로 채운다. */
    plural(key: PluralKey, count: number, params?: Params): string;
    /** 리소스에 있는 키인가. 서버 code 처럼 밖에서 온 이름을 확인할 때 쓴다. */
    has(key: string): key is MessageKey;
    /** 자릿수 구분 없이 소수 maxFractionDigits 자리까지 적은 숫자. */
    number(value: number, maxFractionDigits: number): string;
};

const MESSAGES: Record<Locale, Messages> = {en, ko};
const INTL_TAG: Record<Locale, string> = {en: 'en-US', ko: 'ko-KR'};

/** FR-3: 언어 목록(없거나 비었으면 language)의 첫 값이 ko 또는 ko-* 면 한국어, 아니면 영어다. Windows 런처와 같은 규칙이다. */
export function detectLocale(languages: readonly string[] | undefined, language?: string): Locale {
    const first = languages !== undefined && languages.length > 0 ? languages[0] : language;
    return first !== undefined && /^ko(-|$)/i.test(first) ? 'ko' : 'en';
}

const fill = (template: string, params: Params | undefined): string =>
    params === undefined ? template
        : template.replace(/\{(\w+)\}/g, (whole, name: string) => Object.hasOwn(params, name) ? String(params[name]) : whole);

const create = (locale: Locale): Translator => {
    const messages = MESSAGES[locale];
    const intl = INTL_TAG[locale];
    const plurals = new Intl.PluralRules(intl);
    const numbers = new Map<number, Intl.NumberFormat>();
    const t = (key: MessageKey, params?: Params): string => fill(messages[key], params);
    return {
        locale, intl, t,
        plural: (key, count, params) => t(`${key}_${plurals.select(count) === 'one' ? 'one' : 'other'}` as MessageKey, {...params, count}),
        has: (key): key is MessageKey => Object.hasOwn(messages, key),
        number: (value, maxFractionDigits) => {
            let format = numbers.get(maxFractionDigits);
            if(!format) {
                format = new Intl.NumberFormat(intl, {useGrouping: false, maximumFractionDigits: maxFractionDigits});
                numbers.set(maxFractionDigits, format);
            }
            return format.format(value);
        },
    };
};

const TRANSLATORS: Record<Locale, Translator> = {en: create('en'), ko: create('ko')};

export const translator = (locale: Locale): Translator => TRANSLATORS[locale];

let current: Translator = TRANSLATORS.en;

/** 앱의 언어. 문구를 만드는 함수의 Translator 인자 기본값이다. */
export const i18n = (): Translator => current;

/** 앱의 언어로 만든 문구. */
export const t = (key: MessageKey, params?: Params): string => current.t(key, params);

/** FR-3·FR-5: 브라우저 언어로 앱의 언어를 정하고 <html lang> 에 적는다. 앱이 시작할 때 한 번 부른다. */
export function startI18n(browser: {readonly languages?: readonly string[]; readonly language?: string}, root: {lang: string}): Locale {
    current = TRANSLATORS[detectLocale(browser.languages, browser.language)];
    root.lang = current.locale;
    return current.locale;
}
