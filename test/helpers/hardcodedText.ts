import fs from "fs";
import path from "path";
import ts from "typescript";

// 이슈 349 FR-8 — 관리 화면 소스에 하드코딩으로 남은 영어 문구를 찾는다. test/unit/admin/hardcoded-text.test.ts 가 CI 에서 부른다.
//
// 찾는 것:
//   template-text  .svelte 템플릿의 글자, 그리고 글자 자리의 식 {…} 안 리터럴.
//   text-attribute 사용자에게 보이는 HTML 속성과 글자를 그리는 부품 속성(TEXT_NAMES)의 값, 그 이름을 키로 쓴 객체 값과 대입.
//   sentence       .svelte 의 <script>·속성 식과 .ts 모듈의 리터럴 가운데 영어 문장 모양인 것(영어 단어 2개 이상, 또는 마침표로 끝나는 한 단어).
// 허용하는 것: 제품 이름·단위·프로토콜 같은 코드 값(ALLOWED_WORDS), 공백 없이 소문자로 시작하는 코드 값('alarm', 'tunnels.title'),
//   CSS 값, 마크업 문자열, 경로, 주석, 비교 연산의 피연산자.

export type Finding = {file: string; line: number; rule: "template-text" | "text-attribute" | "sentence"; text: string};

/** 값이 낱말 목록이 아닌 토큰인 속성. 값을 보지 않는다. */
const TOKEN_ATTRIBUTES = new Set(["class", "autocomplete", "inputmode", "type", "accept", "role", "id", "for", "name"]);

/** 화면에 그려지는 속성과 객체 키. */
const TEXT_NAMES = new Set(["aria-label", "aria-description", "title", "placeholder", "alt", "label", "hint", "error", "message", "sub", "ariaLabel"]);

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

/** 글자 자리의 값이 영어 문구인가. 공백 없이 대문자가 아닌 글자로 시작하면 코드 값으로 본다. */
const isText = (value: string): boolean => {
    const plain = value.split(SUBSTITUTION).join(" ").trim();
    if(isMarkup(plain) || isCss(value) || isFormat(plain)) return false;
    if(!/\s/.test(plain) && !/^[A-Z]/.test(plain)) return false;
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

/** compared: 비교 연산의 피연산자다. thrown: new XxxError(…)·super(…) 의 인자로, 화면에 보이지 않는 개발자용 문구다. */
type Literal = {value: string; start: number; textSlot: boolean; compared: boolean; thrown: boolean};

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

/** 코드 조각의 문자열 리터럴. 템플릿 리터럴은 치환 자리를 SUBSTITUTION 으로 바꾼 하나의 값이다. */
const literalsOf = (code: string): Literal[] => {
    const tokens = tokensOf(code);
    const literals: Literal[] = [];
    const open: Array<{index: number; parts: string[]}> = [];
    const contextOf = (first: number, last: number): Pick<Literal, "textSlot" | "compared" | "thrown"> => {
        const before = tokens[first - 1];
        const key = tokens[first - 2];
        const after = tokens[last + 1];
        const textSlot = before !== undefined && ASSIGN_OR_KEY.has(before.kind) && key !== undefined
            && (key.kind === ts.SyntaxKind.Identifier || key.kind === ts.SyntaxKind.StringLiteral) && TEXT_NAMES.has(key.kind === ts.SyntaxKind.Identifier ? key.text : key.value);
        const compared = (before !== undefined && EQUALITY.has(before.kind)) || (after !== undefined && EQUALITY.has(after.kind));
        const thrown = before?.kind === ts.SyntaxKind.OpenParenToken && key !== undefined
            && (key.kind === ts.SyntaxKind.SuperKeyword || (key.kind === ts.SyntaxKind.Identifier && /Error$/.test(key.text) && tokens[first - 3]?.kind === ts.SyntaxKind.NewKeyword));
        return {textSlot, compared, thrown};
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

/** 코드 자리(<script>, 속성 식, 블록 태그, .ts 모듈). 글자 속성 이름에 준 값과 문장 모양의 리터럴을 찾는다. */
const checkCode = (code: string, offset: number, report: Report) => {
    for(const literal of literalsOf(code)) {
        if(literal.compared || literal.thrown) continue;
        if(literal.textSlot && isText(literal.value)) report("text-attribute", literal.value, offset + literal.start);
        else if(isSentence(literal.value)) report("sentence", literal.value, offset + literal.start);
    }
};

/** 글자 자리의 식(템플릿 글자의 {…}, 글자 속성의 값). 비교의 피연산자가 아닌 리터럴은 모두 글자다. */
const checkTextExpression = (code: string, offset: number, rule: Finding["rule"], report: Report) => {
    for(const literal of literalsOf(code)) {
        if(literal.compared) continue;
        if(isText(literal.value)) report(rule, literal.value, offset + literal.start);
        else if(isSentence(literal.value)) report("sentence", literal.value, offset + literal.start);
    }
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

/** 따옴표 속성 값 "a {b} c" 를 글자 조각과 식 조각으로 나눈다. */
const checkQuotedValue = (source: string, from: number, to: number, textual: boolean, report: Report) => {
    let i = from;
    let text = "";
    let textStart = from;
    const flush = () => {
        if(textual && isText(text)) report("text-attribute", text.trim(), textStart);
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
            if(textual && isText(source.slice(valueStart, i))) report("text-attribute", source.slice(valueStart, i), valueStart);
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
