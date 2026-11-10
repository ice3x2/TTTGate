import fs from "fs";
import path from "path";
import ts from "typescript";

// 이슈 349 FR-8 — 관리 화면 소스에 하드코딩으로 남은 영어 문구를 찾는다. test/unit/admin/hardcoded-text.test.ts 가 CI 에서 부른다.
//
// 찾는 것:
//   template-text  .svelte 템플릿의 글자, 그리고 글자 자리의 식 {…} 안 리터럴.
//   text-attribute 속성의 따옴표 값(토큰 속성 TOKEN_ATTRIBUTES·data-*·이벤트·지시어는 뺀다), 글자를 그리는 속성(TEXT_NAMES)의 식,
//                  그 이름을 키로 쓴 객체 값과 대입(textContent 처럼 DOM 에 글자를 넣는 대입 포함), alert·confirm·prompt 의 인자.
//                  삼항식의 갈래는 삼항식 전체가 놓인 자리로 따진다(message: busy ? 'Saving' : 'Saved').
//   sentence       .svelte 의 <script>·속성 식과 .ts 모듈의 리터럴 가운데 영어 문장 모양인 것(영어 단어 2개 이상, 또는 마침표로 끝나는 한 단어).
//   raw-error      잡은 예외의 원문(e.message, e + '', String(e), `${e}`, e.toString()). 화면에 그대로 보이면 번역되지 않는다.
//                  별칭(const err = e as Error)과 구조 분해(catch({message}), const {message} = e)도 따라간다.
//                  예외 객체는 글자 이름의 값({message: e}), 화면 상태에 대입(error = e), 처리 함수가 아닌 함수의 인자(alert(e))일 때 잡는다.
//                  원문으로 조건을 따지는 것(e.message.includes('abort'), e.message === 'x', isSessionOut(e))은 잡지 않는다.
// 허용하는 것: 제품 이름·단위·프로토콜 같은 코드 값(ALLOWED_WORDS), CSS 값, 마크업 문자열, 경로·호스트·문구 키, 주석, 비교 연산의 피연산자.
//   글자 자리(템플릿 글자의 식, TEXT_NAMES 의 값)가 아닌 곳에서는 공백 없이 소문자로 시작하는 값('alarm', 'ghost')도 코드 값으로 본다.
//   글자 자리에서도 문구·형식 함수(CODE_ARGUMENT_CALLEES)의 인자(t('tunnels.title'), dateTime({month: 'short'}))는 코드 값이다.
//   예외 원문이라도 로그(console.*), 번역 문구의 값(t(…, {reason: e.message})), 다시 던지는 예외(new Error(e.message))는 허용한다.

export type Finding = {file: string; line: number; rule: "template-text" | "text-attribute" | "sentence" | "raw-error"; text: string};

/** 값이 낱말 목록이 아닌 토큰인 속성. 따옴표 값도 {…} 식도 보지 않는다. */
const TOKEN_ATTRIBUTES = new Set(["class", "autocomplete", "inputmode", "type", "accept", "role", "id", "for", "name"]);

/** 따옴표 값이 토큰인 속성. 따옴표 값만 건너뛰고 {…} 식은 코드로 검사한다. data-*, 지시어(bind:·class: 등)도 같다. */
const TOKEN_VALUE_ATTRIBUTES = new Set(["style", "href", "src", "download", "target", "rel", "lang", "dir", "method", "action", "enctype", "pattern", "tabindex",
    "variant", "size", "tone", "kind", "align", "icon", "viewBox", "xmlns", "d", "points", "fill", "stroke", "transform", "preserveAspectRatio"]);
const isTokenValueAttribute = (name: string) => TOKEN_ATTRIBUTES.has(name) || TOKEN_VALUE_ATTRIBUTES.has(name)
    || /^(data-|aria-(hidden|live|current|expanded|controls|labelledby|describedby|haspopup|modal|pressed|checked|selected|disabled|invalid|busy|atomic|relevant|autocomplete|orientation|sort|level|posinset|setsize|owns|activedescendant|required|readonly|multiselectable|errormessage|value(now|min|max))$|stroke-|fill-)|:/.test(name);

/** 화면에 그려지는 속성과 객체 키, DOM 에 글자를 넣는 속성. */
const TEXT_NAMES = new Set(["aria-label", "aria-description", "aria-roledescription", "aria-valuetext", "aria-placeholder", "title", "placeholder", "alt",
    "label", "hint", "error", "message", "sub", "ariaLabel", "textContent", "innerText", "text", "heading", "description", "caption"]);

const ALLOWED_WORDS = new Set([
    "TTTGate",
    "KiB", "MiB", "GiB", "TiB", "KB", "MB", "GB", "TB", "Kb", "Mb", "Gb", "bps", "Kbps", "Mbps", "Gbps", "ms",
    "TCP", "UDP", "HTTP", "HTTPS", "TLS", "IP", "IPv4", "IPv6", "CIDR", "URL", "JSON", "PEM", "CSRF", "UTC", "ID", "MAC", "CPU", "RAM", "OS", "RX", "TX", "QR", "CA", "CORS",
    "tcp", "udp", "http", "https",
]);

const SUBSTITUTION = "${…}";

const isMarkup = (value: string) => /^\s*</.test(value);
/** CSS 값과 선택자. */
const isCss = (value: string) => /var\(--|(\d|\$\{…\})(px|rem|em|vh|vw|fr|deg)\b|\[[\w-]+(=[^\]]*)?\]|:not\(/.test(value);
/** PEM 경계 줄이나 명령줄(--옵션) 같은 형식 문자열. */
const isFormat = (value: string) => /-----(BEGIN|END)\b|\bKEY-----|(^|\s)--[a-z][\w-]*/.test(value);
const englishWords = (value: string) => (value.replace(/&\w+;/g, " ").match(/[A-Za-z][A-Za-z0-9']*/g) ?? [])
    .filter((word) => word.length >= 2 && !ALLOWED_WORDS.has(word));

/**
 * 코드 값 모양. 소문자로 시작해 점으로 이은 호스트·문구 키(gw.example.com, tunnels.title), 빗금으로 시작하는 경로,
 * 소문자 낱말을 쌍점으로 이은 코드 값(system:migrated), 숫자가 섞이고 글자로 끝나는 예시 ID(edge-1).
 * "Done."·"Port:"·"On/Off" 처럼 끝이 문장 부호이거나 대문자 낱말을 이은 값은 아니다.
 */
const isDottedToken = (plain: string) => /^[a-z0-9][\w-]*([.:][\w-]+)+$/.test(plain) || /^\/[\w./-]*$/.test(plain) || /^(?=.*\d)[\w.:/@-]*\w$/.test(plain);

/**
 * 값이 영어 문구인가. strict 는 글자 자리(템플릿 글자의 식, 글자 속성)다. 그곳에서는 소문자 한 단어도 문구다.
 * strict 가 아니면 공백 없이 대문자가 아닌 글자로 시작하는 값을 코드 값으로 본다.
 */
const isText = (value: string, strict: boolean): boolean => {
    const plain = value.split(SUBSTITUTION).join(" ").trim();
    if(isMarkup(plain) || isCss(value) || isFormat(plain) || isDottedToken(plain)) return false;
    if(!strict && !/\s/.test(plain) && !/^[A-Z]/.test(plain)) return false;
    return englishWords(plain).length > 0;
};

/** 코드 자리의 리터럴이 영어 문장 모양인가. */
const isSentence = (value: string): boolean => {
    const plain = value.split(SUBSTITUTION).join(" ").trim();
    if(isMarkup(plain) || isCss(value) || isFormat(plain)) return false;
    if(/^[A-Z][a-z']+[.!?…]$/.test(plain)) return true;
    const words = plain.split(/\s+/).map((token) => token.replace(/^[("']+|[.,:;!?…)"']+$/g, ""))
        .filter((token) => /^[A-Za-z][A-Za-z']+$/.test(token) && !ALLOWED_WORDS.has(token));
    return words.length >= 2;
};

/**
 * compared: 비교 연산의 피연산자다. thrown: new XxxError(…)·super(…) 의 인자로, 화면에 보이지 않는 개발자용 문구다.
 * callArg: 문구·형식 함수(CODE_ARGUMENT_CALLEES) 호출의 인자 안에 있다(문구 키, 형식 옵션).
 */
type Literal = {value: string; start: number; textSlot: boolean; compared: boolean; thrown: boolean; callArg: boolean};

const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
const ASSIGN_OR_KEY = new Set([ts.SyntaxKind.ColonToken, ts.SyntaxKind.EqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken]);
/** 이 토큰 뒤의 / 는 나눗셈이다. 그 밖의 곳이면 정규식 리터럴로 다시 읽는다. */
const ENDS_OPERAND = new Set([ts.SyntaxKind.Identifier, ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.CloseParenToken,
    ts.SyntaxKind.CloseBracketToken, ts.SyntaxKind.CloseBraceToken, ts.SyntaxKind.ThisKeyword, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateTail]);

type Token = {kind: ts.SyntaxKind; text: string; value: string; start: number};

const tokensOf = (code: string): Token[] => {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, code);
    const braces: boolean[] = [];
    const tokens: Token[] = [];
    for(let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
        if((kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) && !ENDS_OPERAND.has(tokens.at(-1)?.kind ?? ts.SyntaxKind.Unknown)) {
            kind = scanner.reScanSlashToken();
        }
        if(kind === ts.SyntaxKind.OpenBraceToken) braces.push(false);
        else if(kind === ts.SyntaxKind.TemplateHead) braces.push(true);
        else if(kind === ts.SyntaxKind.CloseBraceToken && braces.pop()) {
            kind = scanner.reScanTemplateToken(false);
            if(kind === ts.SyntaxKind.TemplateMiddle) braces.push(true);
        }
        tokens.push({kind, text: scanner.getTokenText(), value: scanner.getTokenValue(), start: scanner.getTokenStart()});
    }
    return tokens;
};

/** 글자 자리에서도 인자를 코드 값으로 보는 호출. 문구 키와 형식 옵션을 받는다. */
const CODE_ARGUMENT_CALLEES = new Set(["t", "plural", "has", "dateTime", "number", "list", "toLocaleString", "toLocaleDateString", "toLocaleTimeString",
    "DateTimeFormat", "NumberFormat", "RelativeTimeFormat", "PluralRules", "ListFormat", "DisplayNames"]);

/** 이 토큰 뒤의 ( 는 함수 호출을 연다. */
const CALLEE_END = new Set([ts.SyntaxKind.Identifier, ts.SyntaxKind.CloseParenToken, ts.SyntaxKind.CloseBracketToken, ts.SyntaxKind.QuestionDotToken, ts.SyntaxKind.SuperKeyword]);

/** 로그 객체. console.log·logger.warn 처럼 이 객체의 메서드 호출은 객체 이름으로 본다. */
const LOG_OBJECTS = new Set(["console", "logger"]);

/** 토큰마다 감싸고 있는 함수 호출의 이름 목록(바깥부터). 이름을 모르는 호출은 빈 문자열이다. console.log 는 "console", logger.warn 은 "logger" 다. */
const calleesOf = (tokens: Token[]): string[][] => {
    const stack: Array<string | undefined> = [];
    return tokens.map((token, index) => {
        const enclosing = stack.filter((callee): callee is string => callee !== undefined);
        if(token.kind === ts.SyntaxKind.OpenParenToken) {
            const before = tokens[index - 1];
            if(before === undefined || !CALLEE_END.has(before.kind)) stack.push(undefined);
            else if(before.kind !== ts.SyntaxKind.Identifier) stack.push("");
            else {
                const owner = tokens[index - 2]?.kind === ts.SyntaxKind.DotToken ? tokens[index - 3]?.text : undefined;
                stack.push(owner !== undefined && LOG_OBJECTS.has(owner) ? owner : before.text);
            }
        } else if(token.kind === ts.SyntaxKind.CloseParenToken) {
            stack.pop();
        }
        return enclosing;
    });
};

/** 인자를 그대로 대화 상자에 보이는 브라우저 함수. 인자 자리는 글자 자리다. */
const DIALOG_CALLEES = new Set(["alert", "confirm", "prompt"]);

/**
 * 삼항식 갈래인 리터럴의 시작 위치 → 그 삼항식 전체(겹친 삼항식이면 가장 바깥)의 [시작, 끝).
 * 갈래가 글자 자리인지는 삼항식 전체의 앞뒤로 따진다(message: busy ? 'Saving' : 'Saved').
 */
const ternaryBranchesOf = (code: string): Map<number, {start: number; end: number}> => {
    const source = ts.createSourceFile("fragment.ts", code, ts.ScriptTarget.Latest, true);
    const branches = new Map<number, {start: number; end: number}>();
    const visit = (node: ts.Node, root: ts.ConditionalExpression | undefined): void => {
        if(!ts.isConditionalExpression(node)) {
            ts.forEachChild(node, (child) => visit(child, undefined));
            return;
        }
        const outer = root ?? node;
        visit(node.condition, undefined);
        for(const branch of [node.whenTrue, node.whenFalse]) {
            let inner: ts.Expression = branch;
            while(ts.isParenthesizedExpression(inner)) inner = inner.expression;
            if(ts.isConditionalExpression(inner)) {
                visit(inner, outer);
                continue;
            }
            if(ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) || ts.isTemplateExpression(inner)) {
                branches.set(inner.getStart(source), {start: outer.getStart(source), end: outer.getEnd()});
            }
            visit(inner, undefined);
        }
    };
    visit(source, undefined);
    return branches;
};

/** 코드 조각의 문자열 리터럴. 템플릿 리터럴은 치환 자리를 SUBSTITUTION 으로 바꾼 하나의 값이다. */
const literalsOf = (code: string): Literal[] => {
    const tokens = tokensOf(code);
    const callees = calleesOf(tokens);
    const branches = ternaryBranchesOf(code);
    const literals: Literal[] = [];
    const open: Array<{index: number; parts: string[]}> = [];
    /** 리터럴이 놓인 식의 토큰 범위. 삼항식 갈래면 삼항식 전체다. */
    const spanOf = (first: number, last: number): [number, number] => {
        const branch = branches.get(tokens[first].start);
        if(branch === undefined) return [first, last];
        const from = tokens.findIndex((token) => token.start === branch.start);
        const to = tokens.findIndex((token) => token.start + token.text.length === branch.end);
        return from < 0 || to < 0 ? [first, last] : [from, to];
    };
    const contextOf = (first: number, last: number): Pick<Literal, "textSlot" | "compared" | "thrown" | "callArg"> => {
        const [spanFirst, spanLast] = spanOf(first, last);
        const before = tokens[first - 1];
        const key = tokens[first - 2];
        const after = tokens[last + 1];
        const spanBefore = tokens[spanFirst - 1];
        const spanKey = tokens[spanFirst - 2];
        const spanAfter = tokens[spanLast + 1]?.kind;
        const keyed = spanBefore !== undefined && ASSIGN_OR_KEY.has(spanBefore.kind) && spanKey !== undefined
            && (spanKey.kind === ts.SyntaxKind.Identifier || spanKey.kind === ts.SyntaxKind.StringLiteral)
            && TEXT_NAMES.has(spanKey.kind === ts.SyntaxKind.Identifier ? spanKey.text : spanKey.value);
        // 인자 전체이거나, 인자의 기본 문구(alert(message || 'Failed'), confirm(text ?? 'Delete'))다.
        const defaulted = spanBefore?.kind === ts.SyntaxKind.BarBarToken || spanBefore?.kind === ts.SyntaxKind.QuestionQuestionToken;
        const dialogArgument = (spanBefore?.kind === ts.SyntaxKind.OpenParenToken || spanBefore?.kind === ts.SyntaxKind.CommaToken || defaulted)
            && (spanAfter === ts.SyntaxKind.CloseParenToken || spanAfter === ts.SyntaxKind.CommaToken)
            && DIALOG_CALLEES.has(callees[spanFirst].at(-1) ?? "");
        const textSlot = keyed || dialogArgument;
        const compared = (before !== undefined && EQUALITY.has(before.kind)) || (after !== undefined && EQUALITY.has(after.kind));
        const thrown = before?.kind === ts.SyntaxKind.OpenParenToken && key !== undefined
            && (key.kind === ts.SyntaxKind.SuperKeyword || (key.kind === ts.SyntaxKind.Identifier && /Error$/.test(key.text) && tokens[first - 3]?.kind === ts.SyntaxKind.NewKeyword));
        return {textSlot, compared, thrown, callArg: callees[first].some((callee) => CODE_ARGUMENT_CALLEES.has(callee))};
    };
    tokens.forEach((token, index) => {
        switch(token.kind) {
            case ts.SyntaxKind.StringLiteral:
            case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
                literals.push({value: token.value, start: token.start, ...contextOf(index, index)});
                break;
            case ts.SyntaxKind.TemplateHead:
                open.push({index, parts: [token.value]});
                break;
            case ts.SyntaxKind.TemplateMiddle:
                open.at(-1)?.parts.push(token.value);
                break;
            case ts.SyntaxKind.TemplateTail: {
                const head = open.pop();
                if(!head) break;
                head.parts.push(token.value);
                literals.push({value: head.parts.join(SUBSTITUTION), start: tokens[head.index].start, ...contextOf(head.index, index)});
                break;
            }
        }
    });
    return literals.sort((a, b) => a.start - b.start);
};

type Report = (rule: Finding["rule"], text: string, offset: number) => void;

/** source[from] 의 여는 토큰에 짝이 되는 닫는 토큰의 위치. */
const closingToken = (tokens: Token[], from: number, open: ts.SyntaxKind, close: ts.SyntaxKind): number => {
    let depth = 0;
    for(let i = from; i < tokens.length; i++) {
        if(tokens[i].kind === open) depth++;
        else if(tokens[i].kind === close && --depth === 0) return i;
    }
    return tokens.length - 1;
};

/**
 * 잡은 예외를 담은 이름. message 가 참이면 이름이 이미 원문 문구다(catch({message}), const {message} = e, const m = e.message).
 * at 은 이름을 선언한 토큰이고, from·to 는 이름이 살아 있는 토큰 범위다.
 */
type Caught = {name: string; at: number; from: number; to: number; message: boolean};
type Binding = Pick<Caught, "name" | "at" | "message">;

const DECLARATION = new Set([ts.SyntaxKind.ConstKeyword, ts.SyntaxKind.LetKeyword, ts.SyntaxKind.VarKeyword]);

/** tokens[open] 의 { 로 시작하는 구조 분해에서 message 를 받는 이름. {message}, {message: text}, {message = ''} 를 읽는다. */
const destructuredMessagesOf = (tokens: Token[], open: number): Binding[] => {
    const close = closingToken(tokens, open, ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.CloseBraceToken);
    const bindings: Binding[] = [];
    for(let j = open + 1; j < close; j++) {
        const before = tokens[j - 1].kind;
        if(tokens[j].text !== "message" || (before !== ts.SyntaxKind.OpenBraceToken && before !== ts.SyntaxKind.CommaToken)) continue;
        if(tokens[j + 1]?.kind === ts.SyntaxKind.ColonToken && tokens[j + 2]?.kind === ts.SyntaxKind.Identifier) bindings.push({name: tokens[j + 2].text, at: j + 2, message: true});
        else bindings.push({name: "message", at: j, message: true});
    }
    return bindings;
};

/**
 * tokens[at] 에서 시작하는 함수 식의 첫 인자. e => …, (e) => …, (e: unknown) => …, async (e) => …, function(e) {…},
 * 그리고 구조 분해 ({message}) => … 를 읽는다.
 */
const firstParamOf = (tokens: Token[], at: number): Binding[] => {
    let i = at;
    if(tokens[i]?.kind === ts.SyntaxKind.AsyncKeyword) i++;
    if(tokens[i]?.kind === ts.SyntaxKind.FunctionKeyword) i += tokens[i + 1]?.kind === ts.SyntaxKind.Identifier ? 2 : 1;
    if(tokens[i]?.kind === ts.SyntaxKind.OpenParenToken) i++;
    if(tokens[i]?.kind === ts.SyntaxKind.Identifier) return [{name: tokens[i].text, at: i, message: false}];
    return tokens[i]?.kind === ts.SyntaxKind.OpenBraceToken ? destructuredMessagesOf(tokens, i) : [];
};

/** 잡은 예외의 이름과 그 이름이 살아 있는 토큰 범위. catch (e) {…}, .catch(e => …), .then(ok, e => …) 다. */
const caughtNamesOf = (tokens: Token[]): Caught[] => {
    const scopes: Caught[] = [];
    const add = (bindings: Binding[], from: number, to: number) => bindings.forEach((binding) => scopes.push({...binding, from, to}));
    tokens.forEach((token, i) => {
        if(tokens[i + 1]?.kind !== ts.SyntaxKind.OpenParenToken) return;
        const member = tokens[i - 1]?.kind === ts.SyntaxKind.DotToken || tokens[i - 1]?.kind === ts.SyntaxKind.QuestionDotToken;
        const close = closingToken(tokens, i + 1, ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.CloseParenToken);
        if(member && token.text === "catch") {
            add(firstParamOf(tokens, i + 2), i + 2, close);
        } else if(member && token.text === "then") {
            // 두 번째 인자(실패 처리)의 시작은 첫 인자 다음의 최상위 쉼표 뒤다.
            let depth = 0;
            for(let j = i + 2; j < close; j++) {
                const kind = tokens[j].kind;
                if(kind === ts.SyntaxKind.OpenParenToken || kind === ts.SyntaxKind.OpenBraceToken || kind === ts.SyntaxKind.OpenBracketToken) depth++;
                else if(kind === ts.SyntaxKind.CloseParenToken || kind === ts.SyntaxKind.CloseBraceToken || kind === ts.SyntaxKind.CloseBracketToken) depth--;
                else if(kind === ts.SyntaxKind.CommaToken && depth === 0) {
                    add(firstParamOf(tokens, j + 1), j + 1, close);
                    break;
                }
            }
        } else if(token.kind === ts.SyntaxKind.CatchKeyword && !member) {
            const params = closingToken(tokens, i + 1, ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.CloseParenToken);
            if(tokens[params + 1]?.kind !== ts.SyntaxKind.OpenBraceToken) return;
            const bindings = tokens[i + 2]?.kind === ts.SyntaxKind.Identifier ? [{name: tokens[i + 2].text, at: i + 2, message: false}]
                : tokens[i + 2]?.kind === ts.SyntaxKind.OpenBraceToken ? destructuredMessagesOf(tokens, i + 2) : [];
            add(bindings, params + 1, closingToken(tokens, params + 1, ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.CloseBraceToken));
        }
    });
    return scopes;
};

/** 토큰마다 감싸고 있는 가장 안쪽 여는 괄호((, [, {)의 위치. 없으면 -1 이다. */
const enclosingOf = (tokens: Token[]): number[] => {
    const stack: number[] = [];
    return tokens.map((token, index) => {
        const enclosing = stack.at(-1) ?? -1;
        if(token.kind === ts.SyntaxKind.OpenParenToken || token.kind === ts.SyntaxKind.OpenBracketToken || token.kind === ts.SyntaxKind.OpenBraceToken
            || token.kind === ts.SyntaxKind.TemplateHead) stack.push(index);
        else if(token.kind === ts.SyntaxKind.CloseParenToken || token.kind === ts.SyntaxKind.CloseBracketToken || token.kind === ts.SyntaxKind.CloseBraceToken
            || token.kind === ts.SyntaxKind.TemplateTail) stack.pop();
        return enclosing;
    });
};

/** 예외 원문을 써도 되는 호출. 로그, 번역 문구의 값, 다시 던지는 예외(new XxxError(…))다. */
const RAW_ERROR_ALLOWED_CALLEES = new Set([...LOG_OBJECTS, "t", "plural"]);
const rawErrorAllowedIn = (callee: string) => RAW_ERROR_ALLOWED_CALLEES.has(callee) || /Error$/.test(callee);
/**
 * 예외 객체를 받아 번역 문구를 고르는 함수와, 예외를 그대로 넘기는 함수. 예외 객체를 인자로 받아도 원문을 보이지 않는다.
 * failed: 화면마다 둔 실패 처리(InvalidSession 이면 세션을 끝내고 아니면 번역 문구를 알린다), browserMessageOf: 패스키 오류의 번역 문구,
 * reject: Promise 의 실패로 다시 넘긴다. 판별 함수(isXxx·hasXxx)는 isCondition 이, 이름이 Error 로 끝나는 함수는 rawErrorAllowedIn 이 허용한다.
 */
const RAW_ERROR_HANDLERS = new Set(["failed", "browserMessageOf", "reject"]);
const STRING_LITERAL = new Set([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral]);
const COMPARISON = new Set([...EQUALITY, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.InstanceOfKeyword]);
/**
 * 원문으로 조건을 따지는 메서드와 함수. e.message.includes('abort'), /timeout/.test(e.message) 는 화면에 보이지 않는다.
 * is·has 로 시작하는 함수(isSessionOut(e), isCertificateError(e))도 판별 함수다.
 */
const PREDICATES = new Set(["includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "match", "test", "search", "length"]);

/** 잡은 예외의 원문을 글자로 만들거나 화면 쪽으로 넘기는 식. */
const checkRawErrors = (code: string, offset: number, report: Report) => {
    const tokens = tokensOf(code);
    const scopes = caughtNamesOf(tokens);
    if(scopes.length === 0) return;
    const callees = calleesOf(tokens);
    const enclosing = enclosingOf(tokens);
    const declared = new Set(scopes.map((scope) => scope.at));
    const kind = (index: number) => tokens[index]?.kind ?? ts.SyntaxKind.Unknown;
    const slice = (first: number, last: number) => code.slice(tokens[first].start, tokens[last].start + tokens[last].text.length);
    const isMember = (index: number) => kind(index) === ts.SyntaxKind.DotToken || kind(index) === ts.SyntaxKind.QuestionDotToken;

    /** String(e), e.toString(), e + '', '' + e, `${e}`. 예외를 글자로 바꾸는 식의 범위다. */
    const conversionAt = (i: number): [number, number] | undefined => {
        if(isMember(i + 1) && tokens[i + 2]?.text === "toString" && kind(i + 3) === ts.SyntaxKind.OpenParenToken) return [i, i + 4];
        if(kind(i - 1) === ts.SyntaxKind.OpenParenToken && tokens[i - 2]?.text === "String" && kind(i + 1) === ts.SyntaxKind.CloseParenToken) return [i - 2, i + 1];
        if(kind(i + 1) === ts.SyntaxKind.PlusToken && STRING_LITERAL.has(kind(i + 2))) return [i, i + 2];
        if(kind(i - 1) === ts.SyntaxKind.PlusToken && STRING_LITERAL.has(kind(i - 2))) return [i - 2, i];
        return undefined;
    };
    /** 원문으로 조건을 따지는 자리. 비교·부정·&&·? 의 왼쪽, 판별 메서드, if(…)·while(…) 하나, 판별 함수의 인자다. */
    const isCondition = (first: number, last: number): boolean => {
        const before = kind(first - 1);
        const after = kind(last + 1);
        if(COMPARISON.has(before) || COMPARISON.has(after)) return true;
        if(after === ts.SyntaxKind.QuestionToken || after === ts.SyntaxKind.AmpersandAmpersandToken || before === ts.SyntaxKind.ExclamationToken) return true;
        if(isMember(last + 1) && PREDICATES.has(tokens[last + 2]?.text ?? "")) return true;
        if(before === ts.SyntaxKind.OpenParenToken && after === ts.SyntaxKind.CloseParenToken
            && (kind(first - 2) === ts.SyntaxKind.IfKeyword || kind(first - 2) === ts.SyntaxKind.WhileKeyword)) return true;
        const callee = calleeOfArgument(first, last) ?? "";
        return PREDICATES.has(callee) || /^(is|has)[A-Z]/.test(callee);
    };
    /** 식이 함수 호출의 인자 하나 전체면 그 함수 이름(이름을 모르면 빈 문자열)이다. 인자가 아니면 undefined 다. */
    const calleeOfArgument = (first: number, last: number): string | undefined => {
        const open = enclosing[first];
        const before = kind(first - 1);
        const after = kind(last + 1);
        if(open < 0 || kind(open) !== ts.SyntaxKind.OpenParenToken || !CALLEE_END.has(kind(open - 1))) return undefined;
        if((before !== ts.SyntaxKind.OpenParenToken && before !== ts.SyntaxKind.CommaToken) || (after !== ts.SyntaxKind.CloseParenToken && after !== ts.SyntaxKind.CommaToken)) return undefined;
        return kind(open - 1) === ts.SyntaxKind.Identifier ? tokens[open - 1].text : "";
    };
    /** 글자 이름(TEXT_NAMES)의 값이다. {message: e}, error = e, {message} 처럼 줄여 쓴 값. */
    const isTextValue = (first: number, last: number): boolean => {
        const before = tokens[first - 1];
        const key = tokens[first - 2];
        if(before !== undefined && ASSIGN_OR_KEY.has(before.kind) && key !== undefined
            && (key.kind === ts.SyntaxKind.Identifier || key.kind === ts.SyntaxKind.StringLiteral) && TEXT_NAMES.has(key.kind === ts.SyntaxKind.Identifier ? key.text : key.value)) return true;
        const shorthand = first === last && kind(enclosing[first]) === ts.SyntaxKind.OpenBraceToken
            && (before?.kind === ts.SyntaxKind.OpenBraceToken || before?.kind === ts.SyntaxKind.CommaToken)
            && (kind(last + 1) === ts.SyntaxKind.CloseBraceToken || kind(last + 1) === ts.SyntaxKind.CommaToken);
        return shorthand && TEXT_NAMES.has(tokens[first].text);
    };
    /** 선언(const·let·var) 없이 이름에 대입한다. 화면 상태에 넣는 것이다. */
    const isAssigned = (first: number): boolean => {
        const before = kind(first - 1);
        return before === ts.SyntaxKind.EqualsToken || before === ts.SyntaxKind.BarBarEqualsToken || before === ts.SyntaxKind.QuestionQuestionEqualsToken;
    };
    /** const name = <식> 의 name. 식 뒤에 as 형이 붙어도 된다. */
    const declaredNameOf = (first: number): number | undefined =>
        kind(first - 1) === ts.SyntaxKind.EqualsToken && kind(first - 2) === ts.SyntaxKind.Identifier && DECLARATION.has(kind(first - 3)) ? first - 2 : undefined;

    tokens.forEach((token, i) => {
        if(token.kind !== ts.SyntaxKind.Identifier || isMember(i - 1) || declared.has(i)) return;
        const scope = scopes.findLast((candidate) => candidate.name === token.text && i > candidate.from && i <= candidate.to);
        if(scope === undefined || callees[i].some(rawErrorAllowedIn)) return;
        const conversion = conversionAt(i);
        if(conversion !== undefined) {
            report("raw-error", slice(...conversion), offset + tokens[conversion[0]].start);
            return;
        }
        if((kind(i - 1) === ts.SyntaxKind.TemplateHead || kind(i - 1) === ts.SyntaxKind.TemplateMiddle)
            && (kind(i + 1) === ts.SyntaxKind.TemplateMiddle || kind(i + 1) === ts.SyntaxKind.TemplateTail)) {
            report("raw-error", `\${${token.text}}`, offset + token.start);
            return;
        }
        // 식의 범위와 그 값이 원문 문구인지. e.message, e?.message, (e as Error).message 는 원문이다.
        let first = i;
        let last = i;
        let message = scope.message;
        if(!message && isMember(i + 1) && tokens[i + 2]?.text === "message") {
            last = i + 2;
            message = true;
        } else if(!message && kind(i - 1) === ts.SyntaxKind.OpenParenToken && kind(i + 1) === ts.SyntaxKind.AsKeyword) {
            const close = closingToken(tokens, i - 1, ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.CloseParenToken);
            if(isMember(close + 1) && tokens[close + 2]?.text === "message") {
                first = i - 1;
                last = close + 2;
                message = true;
            }
        }
        // 별칭. const err = e as Error, const text = e.message 는 이름을 바꿔 원문을 이어 받는다.
        const alias = declaredNameOf(first);
        if(alias !== undefined) {
            scopes.push({name: tokens[alias].text, at: alias, from: alias, to: scope.to, message});
            declared.add(alias);
            return;
        }
        // 구조 분해. const {message} = e 는 원문을 받는 이름이다.
        if(!message && kind(first - 1) === ts.SyntaxKind.EqualsToken && kind(first - 2) === ts.SyntaxKind.CloseBraceToken) {
            const open = enclosing[first - 2];
            if(kind(open) === ts.SyntaxKind.OpenBraceToken && DECLARATION.has(kind(open - 1))) {
                for(const binding of destructuredMessagesOf(tokens, open)) {
                    scopes.push({...binding, from: binding.at, to: scope.to});
                    declared.add(binding.at);
                }
            }
            return;
        }
        // 예외 객체는 글자 이름의 값, 화면 상태에 대입, 처리 함수가 아닌 함수의 인자일 때 화면에 간다(alert(e)).
        const callee = calleeOfArgument(first, last);
        const shown = !isCondition(first, last)
            && (message || isTextValue(first, last) || isAssigned(first) || (callee !== undefined && !RAW_ERROR_HANDLERS.has(callee)));
        if(shown) report("raw-error", slice(first, last), offset + tokens[first].start);
    });
};

/** 코드 자리(<script>, 속성 식, 블록 태그, .ts 모듈). 글자 속성 이름에 준 값과 문장 모양의 리터럴, 예외 원문을 찾는다. */
const checkCode = (code: string, offset: number, report: Report) => {
    for(const literal of literalsOf(code)) {
        if(literal.compared || literal.thrown) continue;
        if(literal.textSlot && isText(literal.value, true)) report("text-attribute", literal.value, offset + literal.start);
        else if(isSentence(literal.value)) report("sentence", literal.value, offset + literal.start);
    }
    checkRawErrors(code, offset, report);
};

/** 글자 자리의 식(템플릿 글자의 {…}, 글자 속성의 값). 비교의 피연산자와 함수 인자가 아닌 리터럴은 소문자 한 단어도 글자다. */
const checkTextExpression = (code: string, offset: number, rule: Finding["rule"], report: Report) => {
    for(const literal of literalsOf(code)) {
        if(literal.compared) continue;
        if(isText(literal.value, !literal.callArg || literal.textSlot)) report(literal.textSlot ? "text-attribute" : rule, literal.value, offset + literal.start);
        else if(isSentence(literal.value)) report("sentence", literal.value, offset + literal.start);
    }
    checkRawErrors(code, offset, report);
};

const skipQuoted = (source: string, start: number): number => {
    const quote = source[start];
    let i = start + 1;
    while(i < source.length && source[i] !== quote) i += source[i] === "\\" ? 2 : 1;
    return i + 1;
};

/** source[open] 의 { 에 짝이 되는 } 의 위치. 문자열·템플릿 리터럴 안의 중괄호는 세지 않는다. */
const closingBrace = (source: string, open: number): number => {
    let depth = 0;
    let i = open;
    while(i < source.length) {
        const c = source[i];
        if(c === "\"" || c === "'") { i = skipQuoted(source, i); continue; }
        if(c === "`") { i = skipTemplate(source, i); continue; }
        if(c === "{") depth++;
        else if(c === "}" && --depth === 0) return i;
        i++;
    }
    return source.length;
};

const skipTemplate = (source: string, start: number): number => {
    let i = start + 1;
    while(i < source.length) {
        if(source[i] === "\\") { i += 2; continue; }
        if(source[i] === "`") return i + 1;
        if(source[i] === "$" && source[i + 1] === "{") { i = closingBrace(source, i + 1) + 1; continue; }
        i++;
    }
    return i;
};

/** 따옴표 속성 값 "a {b} c" 를 글자 조각과 식 조각으로 나눈다. 글자 조각은 늘 글자로 보고, textual(TEXT_NAMES)이면 소문자 한 단어도 글자다. */
const checkQuotedValue = (source: string, from: number, to: number, textual: boolean, report: Report) => {
    let i = from;
    let text = "";
    let textStart = from;
    const flush = () => {
        if(isText(text, textual)) report("text-attribute", text.trim(), textStart);
        text = "";
    };
    while(i < to) {
        if(source[i] === "{") {
            flush();
            const close = closingBrace(source, i);
            if(textual) checkTextExpression(source.slice(i + 1, close), i + 1, "text-attribute", report);
            else checkCode(source.slice(i + 1, close), i + 1, report);
            i = close + 1;
            textStart = i;
            continue;
        }
        text += source[i++];
    }
    flush();
};

/** <tag …> 를 읽고 속성을 검사한다. 돌려주는 값은 태그가 끝난 다음 위치다. */
const checkTag = (source: string, start: number, report: Report): number => {
    let i = start + 1;
    while(i < source.length && /[^\s>/]/.test(source[i])) i++;
    const tag = source.slice(start + 1, i);
    while(i < source.length) {
        while(/\s/.test(source[i] ?? "")) i++;
        if(source[i] === ">") return i + 1;
        if(source.startsWith("/>", i)) return i + 2;
        if(source[i] === "{") {
            const close = closingBrace(source, i);
            checkCode(source.slice(i + 1, close), i + 1, report);
            i = close + 1;
            continue;
        }
        const nameStart = i;
        while(i < source.length && /[^\s=>/]/.test(source[i])) i++;
        if(i === nameStart) { i++; continue; }
        const name = source.slice(nameStart, i);
        const textual = TEXT_NAMES.has(name);
        if(source[i] !== "=") continue;
        i++;
        if(TOKEN_ATTRIBUTES.has(name)) {
            if(source[i] === "\"" || source[i] === "'") i = skipQuoted(source, i);
            else if(source[i] === "{") i = closingBrace(source, i) + 1;
            continue;
        }
        // <option value> 는 고른 값을 담는 코드 값이다. 글자는 <option> 의 내용이다.
        const tokenValue = isTokenValueAttribute(name) || (tag === "option" && name === "value");
        if(tokenValue && (source[i] === "\"" || source[i] === "'")) {
            i = skipQuoted(source, i);
            continue;
        }
        if(source[i] === "\"" || source[i] === "'") {
            const end = skipQuoted(source, i);
            checkQuotedValue(source, i + 1, end - 1, textual, report);
            i = end;
        } else if(source[i] === "{") {
            const close = closingBrace(source, i);
            if(textual) checkTextExpression(source.slice(i + 1, close), i + 1, "text-attribute", report);
            else checkCode(source.slice(i + 1, close), i + 1, report);
            i = close + 1;
        } else {
            const valueStart = i;
            while(i < source.length && /[^\s>]/.test(source[i])) i++;
            if(!tokenValue && isText(source.slice(valueStart, i), textual)) report("text-attribute", source.slice(valueStart, i), valueStart);
        }
    }
    return i;
};

const checkSvelte = (source: string, report: Report) => {
    let i = 0;
    let text = "";
    let textStart = 0;
    const flush = () => {
        if(englishWords(text).length > 0) report("template-text", text.trim().replace(/\s+/g, " "), textStart + (text.length - text.trimStart().length));
        text = "";
    };
    while(i < source.length) {
        if(source.startsWith("<!--", i)) {
            flush();
            const end = source.indexOf("-->", i);
            i = end < 0 ? source.length : end + 3;
            textStart = i;
            continue;
        }
        const block = /^<(script|style)\b/.exec(source.slice(i, i + 8));
        if(block) {
            flush();
            const open = source.indexOf(">", i) + 1;
            const close = source.indexOf(`</${block[1]}>`, open);
            const end = close < 0 ? source.length : close;
            if(block[1] === "script") checkCode(source.slice(open, end), open, report);
            i = end + block[1].length + 3;
            textStart = i;
            continue;
        }
        if(source[i] === "<" && /[A-Za-z/!]/.test(source[i + 1] ?? "")) {
            flush();
            i = checkTag(source, i, report);
            textStart = i;
            continue;
        }
        if(source[i] === "{") {
            flush();
            const close = closingBrace(source, i);
            const inner = source.slice(i + 1, close);
            const tag = /^\s*[#:/@]\w*/.exec(inner);
            if(tag) checkCode(inner.slice(tag[0].length), i + 1 + tag[0].length, report);
            else checkTextExpression(inner, i + 1, "template-text", report);
            i = close + 1;
            textStart = i;
            continue;
        }
        text += source[i++];
    }
    flush();
};

/** 파일 하나의 하드코딩 문구. file 은 보고에 적을 이름이고, 확장자로 .svelte 와 .ts 를 가른다. */
export function findHardcodedText(file: string, source: string): Finding[] {
    const found: Finding[] = [];
    const lineOf = (offset: number) => source.slice(0, offset).split("\n").length;
    const report: Report = (rule, text, offset) => { found.push({file, line: lineOf(offset), rule, text}); };
    if(file.endsWith(".svelte")) checkSvelte(source, report);
    else checkCode(source, 0, report);
    return found.sort((a, b) => a.line - b.line);
}

/** 검사 대상: admin/src 의 .svelte 와 .ts 전부. 문구 리소스(en.ts·ko.ts)와 선언 파일은 뺀다. */
export function adminTextSources(root: string): string[] {
    const base = path.join(root, "admin/src");
    const skip = new Set([path.join(base, "i18n/en.ts"), path.join(base, "i18n/ko.ts")]);
    const walk = (dir: string): string[] => fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if(entry.isDirectory()) return walk(full);
        const source = entry.name.endsWith(".svelte") || (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"));
        return source && !skip.has(full) ? [full] : [];
    });
    return walk(base).sort();
}
