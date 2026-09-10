# 단위 1 이슈 초안 — 관리자 UI 골격 재작성

근거: [단위 1 설계](../2026-09-11-unit1-admin-ui-shell.md), [프로그램 개요](../2026-09-11-program-overview.md)

## U1-01

**title**: feat(admin): 디자인 토큰·서체·리셋을 app.css 로 이식
**labels**: enhancement, area:frontend, unit:1
**body**:
## 목적

관리자 UI 가 디자인 시스템(`docs/design/admin-design-system.html`)의 CSS 토큰과 서체를 쓸 수 있게 한다. 이 이슈가 끝나면 `app.css` 가 토큰의 단일 출처가 되고, 서체는 외부 요청 없이 번들에서 로드된다. 화면 자체는 아직 바뀌지 않는다.

## 배경

- `admin/src/app.css`(135줄)는 Vite 템플릿 기본 스타일 + Google Fonts `@import` 다. `admin/src/main.ts:1` 이 import 한다.
- `admin/src/app.css` 1~7행이 Google Fonts(Ubuntu)를 `@import` 한다(외부 요청). 이것을 이 이슈에서 제거한다. `admin/src/css/bootstrap.min.css` 는 어디에서도 import 되지 않는 잔재 파일이다(마크업에 `form-control` 같은 클래스명만 남아 있다). **이 이슈에서는 그 파일을 지우지 않는다**(U1-10).
- 디자인 시스템 문서의 마지막 절 "The contract"(`docs/design/admin-design-system.html` 2214행 부근)가 토큰 표를 정의하고 "copy these into app.css" 라고 지시한다. 같은 문서 `<head>` 의 `<link href="https://fonts.googleapis.com/…">` 가 Noto Serif KR·Noto Sans KR·JetBrains Mono 를 외부에서 불러온다.
- 브라우저 테스트 기반: `test/helpers/adminBrowser.ts` 의 `startAdminBrowser()`, 스모크 `test/admin/browser-smoke.test.ts`.

먼저 열어 볼 파일: `admin/src/app.css`, `admin/src/main.ts`, `docs/design/admin-design-system.html`(2214행부터 끝까지), `test/admin/browser-smoke.test.ts`.

## 적용되는 결정

- D5 UI 문구 영어 단일 → 한국어 서체(Noto *KR)와 `--ff-kr-*` 별칭은 만들지 않는다.
- D6 서체는 라틴 서브셋 woff2 를 번들에 포함하고 외부 요청을 두지 않는다.

## 만들 것

### `admin/src/app.css` (전면 교체)

1. `:root` 에 아래 토큰을 정의한다. **값의 출처는 `docs/design/admin-design-system.html` 의 `<style>` 안 `:root` 블록(19~95행)이다.** 마지막 절 "The contract" 표(2215행~)는 요약이라 66개 중 27개만 싣고 있으므로 표가 아니라 `:root` 블록에서 복사한다(hex 가 이 파일에만 존재한다).
   - 배경 `--bg-0 --bg-1 --bg-2 --bg-3 --bg-mute`
   - 선 `--line-0 --line-1 --line-2`
   - 글자 `--ink-0 --ink-1 --ink-2 --ink-3`
   - 의미색 `--signal --signal-fill --signal-dim --signal-glow --pulse --pulse-fill --pulse-dim --pulse-glow --alarm --alarm-fill --alarm-dim --alarm-glow --trace --trace-dim --trace-glow --warn`
   - 서체 `--ff-display --ff-ui --ff-mono` (아래 스택)
   - 크기 `--fs-xs --fs-sm --fs-md --fs-lg --fs-xl --fs-2xl --fs-3xl --fs-4xl --fs-hero`
   - 행간 `--lh-tight --lh-snug --lh-body`
   - 간격 `--s-1 --s-2 --s-3 --s-4 --s-5 --s-6 --s-7 --s-8 --s-9 --s-10 --s-11 --s-12`
   - 모서리 `--r-0 --r-1 --r-2 --r-3`
   - 시간·이징 `--dur-1 --dur-2 --dur-3 --dur-4 --ease-out --ease-in`
2. 서체 스택:
   ```css
   --ff-display: "Noto Serif", Georgia, "Times New Roman", serif;
   --ff-ui: "Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
   --ff-mono: "JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace;
   ```
3. `@font-face` 7개. 형식:
   ```css
   @font-face { font-family: "Noto Serif"; font-style: normal; font-weight: 400; font-display: swap;
     src: url("./assets/fonts/noto-serif-latin-400.woff2") format("woff2");
     unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
   ```
   | family | weight | 파일 |
   |---|---|---|
   | Noto Serif | 400, 600 | `noto-serif-latin-400.woff2`, `noto-serif-latin-600.woff2` |
   | Noto Sans | 400, 500, 700 | `noto-sans-latin-400.woff2`, `noto-sans-latin-500.woff2`, `noto-sans-latin-700.woff2` |
   | JetBrains Mono | 400, 500 | `jetbrains-mono-latin-400.woff2`, `jetbrains-mono-latin-500.woff2` |
4. 리셋(이것만):
   ```css
   *, *::before, *::after { box-sizing: border-box; }
   html { -webkit-text-size-adjust: 100%; }
   body { margin: 0; background: var(--bg-0); color: var(--ink-0); font: var(--fs-md) / var(--lh-body) var(--ff-ui); }
   img, svg { max-width: 100%; display: block; }
   button, input, select, textarea { font: inherit; color: inherit; }
   h1, h2, h3, h4 { font-family: var(--ff-display); line-height: var(--lh-tight); margin: 0; }
   .mono { font-family: var(--ff-mono); font-variant-numeric: tabular-nums; }
   ```
   기존 `app.css` 의 나머지 규칙(`#app`, `.card`, `.logo` 등 Vite 템플릿)은 전부 삭제한다.

### `admin/src/assets/fonts/`

- woff2 7개. 확보 절차(네트워크 필요. 없으면 구현을 멈추고 이슈 코멘트로 보고한다):
  ```
  curl -sA "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" "https://fonts.googleapis.com/css2?family=Noto+Serif:wght@400;600&family=Noto+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" -o fonts.css
  ```
  `fonts.css` 에서 `/* latin */` 주석 바로 아래 블록(`unicode-range` 가 위 라틴 범위인 것)의 `src: url(...)` 7개를 골라 `curl -o admin/src/assets/fonts/<표의 파일명> <url>` 로 받는다. 각 파일은 64KB 이하여야 한다(넘으면 라틴 범위가 아닌 블록을 고른 것이다). `fonts.css` 는 커밋하지 않는다.
- `LICENSE.md`: 세 서체의 저작권 고지(Noto: Google, JetBrains Mono: JetBrains)와 SIL Open Font License 1.1 전문 링크 `https://openfontlicense.org` — 이 파일은 텍스트 문서이므로 외부 URL 검사(R5)의 대상에서 제외한다(테스트가 `assets/fonts/LICENSE.md` 를 건너뛴다).

### `test/admin/design-system-rules.test.ts` (신규)

Node `fs` 로 `admin/src` 를 읽는 Jest 테스트. 이 이슈에서는 R3·R5·R7 만 활성화하고 나머지 규칙은 후속 이슈가 추가한다.

```ts
const TOKENS = ['--bg-0','--bg-1','--bg-2','--bg-3','--bg-mute','--line-0','--line-1','--line-2','--ink-0','--ink-1','--ink-2','--ink-3',
  '--signal','--signal-fill','--signal-dim','--signal-glow','--pulse','--pulse-fill','--pulse-dim','--pulse-glow','--alarm','--alarm-fill','--alarm-dim','--alarm-glow',
  '--trace','--trace-dim','--trace-glow','--warn','--ff-display','--ff-ui','--ff-mono','--fs-xs','--fs-sm','--fs-md','--fs-lg','--fs-xl','--fs-2xl','--fs-3xl','--fs-4xl','--fs-hero',
  '--lh-tight','--lh-snug','--lh-body','--s-1','--s-2','--s-3','--s-4','--s-5','--s-6','--s-7','--s-8','--s-9','--s-10','--s-11','--s-12','--r-0','--r-1','--r-2','--r-3',
  '--dur-1','--dur-2','--dur-3','--dur-4','--ease-out','--ease-in'];
```

- R3: `app.css` 의 `:root {…}` 블록 안에 `TOKENS` 각각이 `--name:` 형태로 정의됨. `--ff-kr-display`, `--ff-kr-ui` 는 정의되어 있지 않음.
- R5: `admin/src/**` 와 `admin/index.html` 의 모든 텍스트 파일에 `/https?:\/\//` 가 없음. **이 이슈 시점에는** 옛 파일이 남아 있으므로 `admin/src/css/`, `admin/src/layout/`, `admin/src/component/`, `admin/src/assets/svelte.svg` 를 검사에서 제외하고(`ServerSetLayout.svelte` 153·154·164·165행과 `svelte.svg` 에 URL 이 있다), `admin/src/assets/fonts/LICENSE.md` 는 영구 제외한다. U1-10 이 옛 파일을 지운 뒤 제외 목록을 `LICENSE.md` 만 남기고 비운다.
- R7: `admin/src/assets/fonts/` 에 위 표의 woff2 7개와 `LICENSE.md` 가 있고, 각 woff2 크기가 1KB 초과 64KB 이하.
- 검사 대상 "텍스트 파일" 은 확장자가 `.svelte .ts .js .css .html .md .json .svg .map` 인 파일만이다(이미지·woff2 는 읽지 않는다).

### `admin/test/fonts-fixture.html` + `admin/test/FontsFixture.svelte` (신규)

세 서체 역할로 "Aa Bb 0123" 을 그리는 페이지. **`FontsFixture.svelte` 첫 줄에 `import '../src/app.css';` 를 넣는다**(`@font-face` 가 없는 페이지에서는 `document.fonts.check()` 가 true 를 돌려주므로, 이 import 가 없으면 테스트가 서체 없이 통과한다). `test/admin/fonts.test.ts`(신규) 가 `startAdminBrowser()` 로 열어 `await document.fonts.load('600 16px "Noto Serif"')`, `load('500 16px "Noto Sans"')`, `load('400 16px "JetBrains Mono"')` 를 실행한 뒤 `[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family)` 가 `Noto Serif`·`Noto Sans`·`JetBrains Mono` 를 모두 포함하고, `page.on('request')` 로 수집한 요청 URL 중 `fonts.googleapis.com`·`fonts.gstatic.com` 이 없음을 단언한다. 기존 `admin/test/fixture.html` 과 `admin/test/server.mjs` 의 방식을 그대로 따른다.

## 변경할 것

- `admin/src/main.ts`: 변경 없음(`./app.css` import 유지).
- `admin/index.html`: `<link rel="icon">` 주석과 외부 URL 이 없음을 확인만 한다.

## 하지 말 것

- `admin/src/css/bootstrap.min.css` 삭제·수정 금지. `layout/*.svelte` 수정 금지(U1-05~09).
- 토큰 값을 "개선"하지 않는다. 디자인 시스템 문서의 값을 그대로 쓴다.
- 한국어 서체·별칭 토큰을 추가하지 않는다.
- 서체 파일을 Git LFS 로 올리지 않는다(7개 합계 300KB 이내라 일반 파일로 둔다).

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/admin/design-system-rules.test.ts`
  - `app.css` 에 TOKENS 전부가 정의되어 있으면 통과, 하나라도 없으면 실패한다.
  - `--ff-kr-display` 가 정의되어 있으면 실패한다.
  - `admin/src` 의 검사 대상 파일(`css/`·`layout/`·`component/`·`assets/svelte.svg`·`assets/fonts/LICENSE.md` 제외)이 `http://` 또는 `https://` 를 포함하면 실패한다.
  - woff2 7개 중 하나라도 없거나 64KB 를 넘으면 실패한다.
- `test/admin/fonts.test.ts`
  - `document.fonts.load` 뒤 loaded 상태인 서체 family 에 세 서체가 모두 있다(`app.css` import 를 빼면 실패한다).
  - 페이지 로드 중 `fonts.googleapis.com`, `fonts.gstatic.com` 으로의 요청이 0건이다.
  - `errors` 가 빈 배열이다.

기존 `test/admin/*.test.ts` 13개가 그대로 통과한다(레이아웃 파일은 손대지 않으므로 화면 구조는 변하지 않는다. Ubuntu 서체가 시스템 서체로 바뀌는 외양 차이는 허용).

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npm --prefix admin run check
npm run test:admin
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: 없음(단위 1 의 첫 이슈).
- 후행: U1-02(ui/ 1차 부품)가 이 토큰을 쓴다.

## 근거 문서

- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §3(층 규칙), §4(토큰·서체), §8.1(R3·R5·R7), §9(U1-01)
- `docs/design/2026-09-11-program-overview.md` §1 D5·D6, §3.2 커밋 규약

---
## U1-02

**title**: feat(admin): ui/ 1차 부품(Button·Field·입력·Card·Chip·Badge) 추가
**labels**: enhancement, area:frontend, unit:1
**body**:
## 목적

디자인 시스템의 기본 부품 10개를 `admin/src/ui/` 에 Svelte 5 룬으로 만든다. 이 이슈가 끝나면 이후 화면 이슈(U1-05~09)가 `<Button>`, `<Field>`, `<TextInput>` 같은 부품만 조합해 화면을 그릴 수 있고, 진열 페이지 `ui-fixture.html` 을 브라우저 테스트가 열어 부품 동작을 검증한다. 기존 화면은 아직 이 부품을 쓰지 않는다.

## 배경

- `admin/src/ui/` 는 아직 없다. 기존 부품은 `admin/src/component/` 에 Svelte 4 문법(`export let`, `createEventDispatcher`, `<svelte:options accessors/>`)으로 있다: `AlertLayout.svelte`(75줄), `Gauge.svelte`(288줄), `Loading.svelte`(58줄), `Switch.svelte`(166줄), `Timer.svelte`(318줄). 이 이슈는 그중 `Switch.svelte` 의 동작(클릭으로 `on` 토글, 변경 시 이벤트)만 새 `ui/Switch.svelte` 로 옮긴다. 나머지는 U1-03.
- 기존 마크업은 부트스트랩 클래스명(`form-control`, `form-label`)만 남아 있고 실제 CSS 는 로드되지 않는다(`admin/src/css/bootstrap.min.css` 는 어디에서도 import 되지 않는다).
- 토큰과 서체는 U1-01 이 `admin/src/app.css` 에 넣었다. 색은 `var(--signal)` 처럼 토큰으로만 쓴다.
- 디자인 시스템 `docs/design/admin-design-system.html` 의 CSS 원본 위치(줄 번호): `.card` 333~391, `.btn` 530~596, `.switch` 598~626, `.field`·`.input`·`.select` 628~680, `.check` 683~706, `.badge` 739~752. 이 블록을 그대로 복사해 각 부품의 `<style>` 에 넣는다. 문서의 `.btn.primary` 와 `.check.on .box::after` 가 쓰는 `#FFF5F0` 은 `.svelte` 안에 hex 를 둘 수 없으므로 `app.css` 에 토큰 `--ink-on-signal: #FFF5F0` 을 한 줄 추가해 참조한다.
- 브라우저 테스트 기반: `test/helpers/adminBrowser.ts` 의 `startAdminBrowser()` (반환 `{page, url, errors, close}`, 뷰포트 미설정), 기존 fixture 방식 `admin/test/certificate.html` + `admin/test/CertificateFixture.svelte`(`mount(Component, {target: document.getElementById('fixture')})`).
- 구조 규칙 테스트 `test/admin/design-system-rules.test.ts` 는 U1-01 이 R3·R5·R7 로 만들었다. 이 이슈가 R1·R2 를 추가한다.
- 설치된 Svelte 는 5.57.0(`admin/package-lock.json`)이다. `$props()`, `$bindable()`, 스니펫, `$props.id()` 를 모두 쓸 수 있다.

먼저 열어 볼 파일: `admin/src/component/Switch.svelte`, `admin/src/app.css`, `docs/design/admin-design-system.html`(위 줄 범위), `test/admin/design-system-rules.test.ts`, `admin/test/certificate.html`, `admin/test/CertificateFixture.svelte`, `test/helpers/adminBrowser.ts`.

## 적용되는 결정

- D2 기존 화면도 디자인 시스템으로 전면 재작성 → 부품은 디자인 시스템 CSS 를 그대로 쓴다.
- D3 모바일 우선 → 모든 입력 부품은 `width: 100%`, 버튼·스위치의 탭 영역은 높이 40px 이상.
- D5 UI 문구 영어 단일.

## 만들 것

### 공통 규칙 (모든 `ui/*.svelte`)

1. `<script lang="ts">` 에서 `let {…} = $props()` 로 prop 을 받는다. 양방향 값은 `$bindable()`. 자식 콘텐츠는 `children` 스니펫(`{@render children?.()}`).
2. 모든 부품은 `class` prop(`let {class: className = ''} = $props()`)을 받아 루트 요소의 class 에 덧붙인다.
3. `fetch`, `adminRequest`, `../controller/*` import 금지(R1). 색은 토큰만(R2).
4. 아래 표에 없는 prop 은 만들지 않는다.
5. `admin/src/ui/tone.ts`: `export type Tone = 'signal' | 'pulse' | 'alarm' | 'trace' | 'warn' | 'neutral';` — `Chip`·`Badge` 가 import 한다(U1-03 의 `Toast`·`Banner` 도).

### 부품 계약

| 파일 | props | 콜백/스니펫 | 루트 요소와 클래스 |
|---|---|---|---|
| `Button.svelte` | `variant: 'primary'\|'ghost'\|'danger' = 'ghost'`, `size: 'sm'\|'md' = 'md'`, `disabled = false`, `type: 'button'\|'submit' = 'button'`, `class` | `onclick?: (e: MouseEvent) => void`, `children` | `<button class="btn {variant} {size === 'sm' ? 'sm' : ''} {className}" {type} {disabled} {onclick}>` |
| `Field.svelte` | `label: string`, `hint?: string`, `error?: string`, `for?: string`(`let {for: htmlFor} = $props()`), `class` | `children`(입력 요소) | `<div class="field {className}"><label for={htmlFor}>{label}</label>{@render children()}{#if error}<div class="err-msg" role="alert">{error}</div>{:else if hint}<div class="hint">{hint}</div>{/if}</div>` |
| `TextInput.svelte` | `value = $bindable('')`, `id?`, `type: 'text'\|'password' = 'text'`, `placeholder?`, `disabled = false`, `autocomplete?: FullAutoFill`(`import type {FullAutoFill} from 'svelte/elements'`), `invalid = false`, `inputmode?: 'text'\|'numeric'`, `class` | `oninput?: (value: string) => void`, `onkeydown?: (e: KeyboardEvent) => void` | `<input class="input {invalid ? 'err' : ''} {className}" {id} {type} {placeholder} {disabled} {autocomplete} {inputmode} aria-invalid={invalid \|\| undefined} bind:value oninput={() => oninput?.(value)} {onkeydown}>` |
| `NumberInput.svelte` | `value = $bindable<number \| null>(null)`, `id?`, `min?: number`, `max?: number`, `step?: number \| 'any'`, `disabled = false`, `invalid = false`, `class` | `oninput?: (value: number \| null) => void` | `<input type="number" class="input mono {invalid ? 'err' : ''} {className}" {id} {min} {max} {step} {disabled} aria-invalid={invalid \|\| undefined} bind:value oninput={() => oninput?.(value)}>` — Svelte 5 는 빈 숫자 입력을 `null` 로 준다. 설계 표의 `undefined` 를 `null` 로 정정한다 |
| `Select.svelte` | `value = $bindable('')`, `id?`, `options: Array<{value: string; label: string}>`, `disabled = false`, `class` | `onchange?: (value: string) => void` | `<select class="select {className}" {id} {disabled} bind:value onchange={() => onchange?.(value)}>{#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}</select>` |
| `Checkbox.svelte` | `checked = $bindable(false)`, `id?`, `label: string`, `disabled = false`, `class` | `onchange?: (checked: boolean) => void` | `<label class="check {checked ? 'on' : ''} {className}"><input type="checkbox" class="box" {id} {disabled} bind:checked onchange={() => onchange?.(checked)}><span>{label}</span></label>` — 네이티브 input 을 `appearance: none` 으로 직접 `.box` 스타일링한다(숨기지 않는다. Playwright `check()`/`uncheck()` 가 이 input 을 조작한다) |
| `Switch.svelte` | `on = $bindable(false)`, `disabled = false`, `ariaLabel: string`, `class` | `onchange?: (on: boolean) => void` | `<button type="button" role="switch" aria-checked={on} aria-label={ariaLabel} class="switch {on ? 'on' : ''} {className}" {disabled} onclick={() => { on = !on; onchange?.(on); }}></button>` |
| `Card.svelte` | `label?: string`, `ticked = false`, `compact = false`, `class` | `children`, `header?` 스니펫 | `<section class="card {ticked ? 'ticked' : ''} {compact ? 'compact' : ''} {className}">{#if header}{@render header()}{:else if label}<div class="card-label">{label}</div>{/if}<div class="card-body">{@render children?.()}</div>{#if ticked}<div class="tickwrap"></div>{/if}</section>` — `.card.compact { padding: var(--s-3); }` 는 신규 |
| `Chip.svelte` | `tone: Tone = 'neutral'`, `mono = false`, `class` | `children` | `<span class="chip {tone} {mono ? 'mono' : ''} {className}">` — 클래스 신규(아래) |
| `Badge.svelte` | `tone: Tone`, `class` | `children` | `<span class="badge {tone} {className}">` — `.badge.signal/.pulse/.alarm/.trace` 는 문서 복사, `.badge.warn { color: var(--warn); border-color: var(--warn); }`, `.badge.neutral { color: var(--ink-2); }` 신규 |

`Chip` 클래스(신규):

```css
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border: 1px solid var(--line-1); border-radius: 999px;
  background: var(--bg-3); font-size: var(--fs-xs); line-height: var(--lh-snug); color: var(--ink-1); white-space: nowrap; }
.chip.mono { font-family: var(--ff-mono); font-variant-numeric: tabular-nums; }
.chip.signal { color: var(--signal); } .chip.pulse { color: var(--pulse); } .chip.alarm { color: var(--alarm); }
.chip.trace { color: var(--trace); } .chip.warn { color: var(--warn); } .chip.neutral { color: var(--ink-2); }
```

`Checkbox` 의 `.box` 는 문서 683~706 의 `.check .box`·`.check.on .box`·`.check.on .box::after` 를 `input.box { appearance: none; margin: 0; position: relative; … }`, `input.box:checked { … }`, `input.box:checked::after { … }` 로 옮긴다. `#FFF5F0` 은 `var(--ink-on-signal)`.

`Switch` 는 `.switch` 블록(598~626)을 복사하되 루트가 `<button>` 이므로 `padding: 0; appearance: none;` 을 추가한다. 탭 영역을 위해 `min-height: 40px` 대신 `::before` 로 44×44 투명 히트 영역을 둔다(`content: ''; position: absolute; inset: -12px -3px;`).

### `admin/src/app.css` (한 줄 추가)

`:root` 블록 끝에 `--ink-on-signal: #FFF5F0;` 을 추가한다. 다른 값은 건드리지 않는다.

### `admin/test/ui-fixture.html` + `admin/test/UiFixture.svelte` (신규)

`certificate.html` 과 같은 방식: `<div id="fixture"></div>` 와 `<script type="module">import {mount} from 'svelte'; import UiFixture from './UiFixture.svelte'; mount(UiFixture, {target: document.getElementById('fixture')});</script>`. `UiFixture.svelte` 는 룬 모드(`$state`)로 쓰고, 아래 요소를 이 순서로 놓는다. U1-03 이 같은 파일에 2차 부품을 덧붙인다.

| 요소 | 내용 |
|---|---|
| Button | `<div id="btn-count"><Button variant="primary" onclick={() => count++}>Count</Button></div>` + `<output id="count">{count}</output>` |
| Button disabled | `<Button disabled>Disabled</Button>` |
| TextInput | `<Field label="Text" for="text-input"><TextInput id="text-input" bind:value={text} /></Field>` + `<output id="text-echo">{text}</output>` |
| NumberInput | `<Field label="Number" for="number-input" error={number !== null && number > 10 ? 'Too large' : undefined}><NumberInput id="number-input" min={0} max={100} bind:value={number} /></Field>` + `<output id="number-echo">{String(number)}</output>` |
| Select | `<Field label="Select" for="select"><Select id="select" options={[{value:'a',label:'A'},{value:'b',label:'B'}]} bind:value={selected} /></Field>` + `<output id="select-echo">{selected}</output>` (초기값 `'a'`) |
| Checkbox | `<Checkbox id="checkbox" label="Fixture checkbox" bind:checked={checked} />` + `<output id="checkbox-echo">{String(checked)}</output>` |
| Switch | `<Switch ariaLabel="Fixture switch" bind:on={on} onchange={() => switchEvents++} />` + `<output id="switch-echo">{String(on)}</output>` + `<output id="switch-events">{switchEvents}</output>` |
| Card | `<Card label="Fixture card"><p>Card body</p></Card>` 와 `<Card ticked compact>Ticked</Card>` |
| Chip | `<Chip mono>1.0.11b</Chip>` |
| Badge | tone 6개를 각각 하나씩. 문구는 tone 이름 대문자(`SIGNAL`, `PULSE`, `ALARM`, `TRACE`, `WARN`, `NEUTRAL`) |

### `test/admin/ui-kit.test.ts` (신규)

`startAdminBrowser()` 로 열고 `await page.setViewportSize({width: 400, height: 800})` 후 `${url}/test/ui-fixture.html` 로 이동한다. 케이스는 수용 기준 참조. 각 `test()` 는 `finally { await close(); }` 와 `expect(errors).toEqual([])` 로 끝난다. 타임아웃 30_000.

### `test/admin/design-system-rules.test.ts` (R1·R2 추가)

- R1: `admin/src/ui/*.svelte` 와 `admin/src/ui/*.ts` 의 내용에 `/fetch\(|adminRequest|from ["']\.\.\/controller/` 가 없다.
- R2: `admin/src/ui/`, `admin/src/shell/`, `admin/src/screens/` 아래(존재하는 디렉터리만, 재귀)의 모든 `.svelte` 파일에 `/(?<![\w-])#[0-9a-fA-F]{3,8}(?![\w-])/` 가 없다(`<style>` 안팎 모두. 앞뒤 경계를 확인해 `#add-user` 같은 id 선택자에 오탐하지 않는다). 설계 §8.1 의 R2 는 `admin/src/**/*.svelte` 전체이지만, 옛 파일(`layout/`, `component/`, U1-04 전의 `App.svelte` 78·106행 `#fff`)이 hex 를 품고 있어 R5 와 같은 이유로 U1-10 까지 범위를 좁힌다. 테스트 코드에 `const NEW_DIRS = ['ui', 'shell', 'screens'];` 로 명시하고, U1-10 이 전체로 넓힌다.

## 변경할 것

- `admin/src/app.css`: `--ink-on-signal` 한 줄 추가.
- `test/admin/design-system-rules.test.ts`: R1·R2 `test()` 추가.
- 그 외 기존 파일 변경 없음. `component/Switch.svelte` 는 지우지 않는다(U1-10).

## 하지 말 것

- `layout/*.svelte`, `component/*.svelte`, `App.svelte` 수정 금지.
- `export let`, `createEventDispatcher`, `on:click` 디렉티브, `<slot>`, `<svelte:options accessors/>` 를 새 파일에 쓰지 않는다. 룬(`$props`, `$bindable`, `$state`, `$derived`)과 스니펫만 쓴다.
- 부품 안에서 `fetch`·컨트롤러 호출 금지.
- 표에 없는 prop(`icon`, `loading`, `fullWidth` 등) 추가 금지. 표에 없는 부품(`Textarea`, `Radio` 등) 추가 금지.
- hex 색상 리터럴을 `.svelte` 에 두지 않는다. 디자인 시스템의 `rgba(...)` 는 그대로 복사해도 된다(R2 는 `#hex` 만 검사한다).
- `Checkbox` 의 네이티브 input 을 `display: none` 이나 `visibility: hidden` 으로 숨기지 않는다.
- 요소 id·class 로 `[0-9a-f]{3,8}` 만으로 이루어진 이름(`face`, `deb`, `add` 같은 것)을 쓰지 않는다(R2 오탐 방지). fixture 의 id 도 같다.
- `admin/svelte.config.js` 에 `compilerOptions.runes` 를 두지 않는다(파일 단위 룬 모드. 옛 `layout/`·`component/` 가 U1-10 까지 legacy 문법으로 공존한다).

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/admin/design-system-rules.test.ts`
  - `admin/src/ui/` 의 어느 파일이든 `fetch(` 또는 `adminRequest` 또는 `from "../controller` 를 포함하면 실패한다.
  - `admin/src/ui/`·`shell/`·`screens/` 의 어느 `.svelte` 파일에든 `#abc` 같은 hex 리터럴이 있으면 실패한다. 그 밖의 경로(`layout/`, `component/`, `App.svelte`)는 이 단계에서 검사하지 않는다.
- `test/admin/ui-kit.test.ts` (모두 `ui-fixture.html`, 뷰포트 400×800)
  - "Count" 버튼을 세 번 클릭하면 `#count` 의 텍스트가 "3" 이다.
  - "Disabled" 버튼은 `isDisabled()` 가 true 이고 `.btn[disabled]` 선택자로 찾을 수 있다.
  - `#text-input` 에 "hello" 를 입력하면 `#text-echo` 가 "hello" 이다. `getByLabel("Text", {exact: true})` 로 같은 요소를 찾을 수 있다.
  - `#number-input` 에 "42" 를 입력하면 `#number-echo` 가 "42" 이고 `.err-msg` 가 "Too large" 를 보인다. 빈 값으로 지우면 `#number-echo` 가 "null" 이다.
  - `#select` 에서 "b" 를 고르면 `#select-echo` 가 "b" 이다.
  - `#checkbox` 를 `check()` 하면 `#checkbox-echo` 가 "true", `uncheck()` 하면 "false" 이다. `getByLabel("Fixture checkbox")` 로 찾을 수 있다.
  - `getByRole("switch", {name: "Fixture switch"})` 의 `aria-checked` 가 "false" 이고, 클릭하면 "true" 로 바뀌며 `#switch-echo` 가 "true", `#switch-events` 가 "1" 이다. 요소의 클래스에 `on` 이 포함된다.
  - "Fixture card" 라벨과 "Card body" 텍스트가 보인다. `.card.ticked.compact` 가 1개 있다.
  - `.chip.mono` 의 텍스트가 "1.0.11b" 이다.
  - `.badge` 가 6개이고 `.badge.pulse` 의 텍스트가 "PULSE" 이다.
  - 모든 `.input` 과 `.select` 의 `getBoundingClientRect().width` 가 400 이하이고 `document.documentElement.scrollWidth === document.documentElement.clientWidth` 이다.
  - `errors` 가 빈 배열이다.

기존 `test/admin/*.test.ts` 전부(U1-01 이 추가한 것 포함)가 그대로 통과한다.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npm --prefix admin run check
npm run test:admin
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U1-01(토큰·서체).
- 후행: U1-03(2차 부품이 `Button`·`Field`·`NumberInput` 을 쓴다), U1-05~09(화면).

## 근거 문서

- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §3(층 규칙 1~3), §6(부품 계약 표), §8.1(R1·R2), §8.3(`ui-kit.test.ts`), §9(U1-02)
- `docs/design/2026-09-11-program-overview.md` §1 D2·D3·D5, §3.1 작업 규약, §3.2 커밋 규약
- `docs/design/admin-design-system.html` 333~391, 530~596, 598~626, 628~706, 739~752 행

---
## U1-03

**title**: feat(admin): ui/ 2차 부품(Modal·Toast·Gauge·Timer 외 4종) 추가
**labels**: enhancement, area:frontend, unit:1
**body**:
## 목적

오버레이·알림·수치 표시 부품 8개를 `admin/src/ui/` 에 추가해 부품 라이브러리를 완성한다. 이 이슈가 끝나면 화면 이슈가 알림을 `AlertLayout` 대신 `Modal`·`toast` 로, 게이지·타이머·로딩을 새 부품으로 그릴 수 있다. 기존 `component/*.svelte` 는 아직 지우지 않지만, 브라우저 fixture 하나(`CertificateFixture.svelte` 의 auxiliary 분기)는 새 부품으로 바꾼다.

## 배경

- 옮길 동작의 원본(모두 Svelte 4 문법, 그대로 복사 금지):
  - `admin/src/component/AlertLayout.svelte`: `show`·`button` prop, `_onClose`(12~17행)가 `close` 이벤트 후 `show = false`. 고정 크기(`width=320`, `height=150`) 팝업. → `Modal` 이 대체한다.
  - `admin/src/component/Gauge.svelte`: `START_ANGLE=-82`, `END_ANGLE=82`(18~19행), `beforeUpdate` 에서 `value` 를 `[min, max]` 로 자르고 `max <= 0` 이면 1(34~50행), `_update`(54~62행)가 `_percent = round(map(value,min,max,0,100),1)` 과 각도를 계산, `_needleToAngle`(66~94행)이 `_needleElement.animate([{transform: rotate(prev)}, {transform: rotate(next)}], {duration, easing: 'ease-in-out', fill: 'forwards'})` 로 바늘을 돌린다. `ExMath.map/round`, `ObjectUtil.equalsDeep` 를 `../controller/` 에서 import 한다(새 부품에서는 R1 때문에 불가 → 두 함수를 부품 안에 인라인).
  - `admin/src/component/Loading.svelte`: `show`·`transition` prop, `loading.png` 를 `setInterval` 200ms 마다 45° 회전(14~25행).
  - `admin/src/component/Timer.svelte`: `TIME_WEIGHT=20`, `MAX_INFINITY_TIME=100`, `START_DEG=95`, `END_DEG=440`(15~26행). 외부 API `reset(time?)`(41~55행), `update(time, startTime?)`(79~94행). `_getTimeString`(108~134행: 일>0 → `{d}d {h}h {m}m`, 시>0 → `{h}h {m}m {s}s`, 그 외 `{m}m {s}s`, 0 이하 → `0m 0s`). 설정 팝업 `_onCloseSetTimeoutAlert`(153~174행)가 일·시·분 입력(`input-timeout-day-{id}` 등, min/max 0~99999/0~23/0~59)을 초로 합산해 값이 바뀌었을 때만 `change {time}` 을 dispatch. 무제한(`_startTime <= 0`)이면 `infinity.png` 와 회전 애니메이션(`second-hand-animation`). 인스턴스 id 는 `GlobalCounter.incrementAndGet()`.
  - 상위 사용처 `admin/src/layout/TunnelOptionSetLayout.svelte` 505~513행: `<Switch on=… on:change>`, `<Timer bind:this={_timerElements[port]} on:change={(e) => _onChangeActive(true, port, e.detail.time)}>`; 176~181행·404~406행에서 1초 폴링마다 `timer.update(_getTimeout(status), status.activeTimeout)` 를 호출한다. 즉 Timer 는 스스로 세지 않고 부모가 매초 남은 초를 밀어 넣는다. 새 `Timer` 는 이것을 prop(`seconds`, `total`)으로 받는다.
- 기존 브라우저 테스트 `test/admin/certificate-lifecycle.test.ts` 의 4번째 케이스("related Gauge and Timer lifecycle paths …", 75~84행)가 `admin/test/CertificateFixture.svelte` auxiliary 분기(`<Gauge value={gaugeValue} duration={0} title="Auxiliary gauge" />`, `<Timer bind:this={timer} />`, `updateAuxiliary: () => { gaugeValue = 50; timer.reset(120); timer.update(60, 120); }`)를 열어 `.percent-box` 에 "50", `.time-text` 가 `/\d+m.*\d+s/` 임을 확인한다. 이 fixture 와 테스트를 새 부품에 맞게 고친다(fixture 는 이 이슈에서는 legacy 문법 그대로 두고 자식만 바꾼다. U1-07 이 룬으로 바꾼다).
- 디자인 시스템 CSS 원본 위치: `.tabs` 755~780, `.kpi` 834~882, `.gauge`·`.gauge-val` 885~917, `.toast` 949~982, `.modal`·`.modal-head`·`.modal-body`·`.modal-foot` 984~1015. "Overlays explain, then commit" 절(1942~1990행)이 모달 시안(헤더 제목 + `.tag`, 본문, 우측 정렬 푸터 버튼 ghost/primary·danger)이다.
- `admin/test/UiFixture.svelte` 와 `test/admin/ui-kit.test.ts` 는 U1-02 가 만들었다. 이 이슈가 덧붙인다.

먼저 열어 볼 파일: 위 `component/*.svelte` 4개, `admin/test/CertificateFixture.svelte`, `test/admin/certificate-lifecycle.test.ts`, `admin/test/UiFixture.svelte`, `test/admin/ui-kit.test.ts`, `docs/design/admin-design-system.html`(위 줄 범위).

## 적용되는 결정

- D2 디자인 시스템으로 전면 재작성.
- D3 모바일 우선 → 모달은 뷰포트 너비 400px 에서 좌우 16px 여백, 토스트는 하단 중앙.
- D5 UI 문구 영어 단일.

## 만들 것

공통 규칙은 U1-02 와 같다(룬, `class` prop, R1·R2). 색은 토큰만.

### `admin/src/ui/Modal.svelte`

- props: `open = $bindable(false)`, `title: string`, `closeOnOverlay = true`, `class`. 스니펫: `children`, `footer?`.
- 마크업(`open` 일 때만 렌더):
  ```svelte
  {#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={(e) => { if (closeOnOverlay && e.target === e.currentTarget) open = false; }}>
    <div class="modal {className}" role="dialog" aria-modal="true" aria-labelledby={titleId} tabindex="-1" bind:this={dialog}>
      <div class="modal-head"><h2 class="ttl" id={titleId}>{title}</h2></div>
      <div class="modal-body">{@render children?.()}</div>
      {#if footer}<div class="modal-foot">{@render footer()}</div>{/if}
    </div>
  </div>
  {/if}
  ```
  `titleId` 는 `$props.id()` 로 만든다.
- 초점: `$effect` 에서 `open` 이 true 가 되면 `document.activeElement` 를 기억하고 `dialog` 안의 첫 포커스 가능 요소(`button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`)에, 없으면 `dialog` 자체에 초점을 준다. `open` 이 false 가 되면(effect cleanup) 기억한 요소에 `focus()` 를 돌려준다.
- 키보드: `open` 일 때 `window` 의 `keydown` 에서 `Escape` → `open = false`. `<svelte:window onkeydown>` 을 쓴다.
- 스타일: `.modal-overlay { position: fixed; inset: 0; z-index: 100; display: flex; justify-content: center; align-items: flex-start; padding: 80px var(--s-4) var(--s-4); overflow-y: auto; }`, `.modal-overlay::before { content: ''; position: fixed; inset: 0; background: var(--ink-0); opacity: .72; }`, `.modal { position: relative; width: 100%; max-width: 480px; border-radius: var(--r-3); }` + 문서 984~1015 블록(`.modal` 의 `border-radius: var(--r-2)` 는 `--r-3` 로 바꾼다). `.modal-head .ttl { margin: 0; }`.

### `admin/src/ui/toast.ts` + `admin/src/ui/Toast.svelte`

```ts
// toast.ts
import type {Tone} from './tone';
export type ToastItem = {id: number; tone: Tone; message: string};
export const toasts: {subscribe(run: (items: ToastItem[]) => void): () => void};   // svelte/store 의 readable
export const toast = {
    push(input: {tone: Tone; message: string; timeoutMs?: number}): number,   // timeoutMs 기본 4000. 0 이면 자동 소멸 없음. 반환 id
    dismiss(id: number): void,
};
```
- `svelte/store` 의 `writable` 로 구현. `push` 는 배열 끝에 추가하고 길이가 3을 넘으면 앞에서 제거한다. `timeoutMs > 0` 이면 `setTimeout(() => dismiss(id), timeoutMs)`.
- `Toast.svelte`(props 없음): `<div class="toasts" aria-live="polite">{#each $toasts as item (item.id)}<div class="toast {item.tone}" role="status"><span class="glyph" aria-hidden="true">{GLYPH[item.tone]}</span><span class="msg">{item.message}</span><button type="button" class="toast-close" aria-label="Dismiss" onclick={() => toast.dismiss(item.id)}>×</button></div>{/each}</div>`. `GLYPH = {pulse: '✓', alarm: '!', warn: '!', trace: 'i', signal: '•', neutral: '•'}`.
- 스타일: 문서 949~982 블록 + `.toast.warn { border-left-color: var(--warn); }`, `.toast.neutral { border-left-color: var(--line-2); }`, `.toasts { position: fixed; z-index: 110; left: var(--s-4); right: var(--s-4); bottom: var(--s-4); display: flex; flex-direction: column; gap: var(--s-2); }`, `@media (min-width: 640px) { .toasts { left: auto; width: 360px; } }`. `.toast-close { background: none; border: 0; color: var(--ink-2); font-size: var(--fs-lg); cursor: pointer; }`.

### `admin/src/ui/Tabs.svelte`

- props: `items: Array<{id: string; label: string}>`, `active = $bindable('')`, `class`. 콜백 `onchange?: (id: string) => void`.
- `<div class="tabs {className}" role="tablist">{#each items as item (item.id)}<button type="button" role="tab" class="tab {active === item.id ? 'active' : ''}" aria-selected={active === item.id} onclick={() => { active = item.id; onchange?.(item.id); }}>{item.label}</button>{/each}</div>`. 스타일: 문서 755~780 + `.tab { background: none; border: 0; border-bottom: 2px solid transparent; }`.

### `admin/src/ui/Kpi.svelte`

- props: `label: string`, `value: string`, `sub?: string`, `accent = false`, `class`.
- `<div class="kpi {accent ? 'accent' : ''} {className}"><div class="k">{label}</div><div class="v">{value}</div>{#if sub}<div class="sub">{sub}</div>{/if}</div>`. 스타일: 문서 834~882(`.delta` 규칙은 복사하지 않는다).

### `admin/src/ui/Gauge.svelte`

- props: `title: string`, `value: number`, `max = 100`, `message: string`, `duration = 900`, `class`.
- 계산(옛 `Gauge.svelte` 로직 유지): `safeMax = max <= 0 ? 1 : max`, `clamped = Math.min(Math.max(value, 0), safeMax)`, `percent = Math.round(clamped / safeMax * 1000) / 10`, `angle = -90 + clamped / safeMax * 180`(옛 ±82 대신 반원에 맞춘 ±90). `map`·`round` 는 부품 안에 인라인 함수로 둔다.
- 마크업:
  ```svelte
  <div class="gauge-wrap {className}">
    <div class="gauge-title">{title}</div>
    <div class="gauge">
      <svg viewBox="0 0 160 100" aria-hidden="true">
        <path class="arc-bg" d="M 20 90 A 60 60 0 0 1 140 90" fill="none" stroke-width="8" />
        <path class="arc-fg" d="M 20 90 A 60 60 0 0 1 140 90" fill="none" stroke-width="8" stroke-dasharray={ARC} stroke-dashoffset={ARC * (1 - percent / 100)} />
        <line class="needle" x1="80" y1="90" x2="80" y2="40" stroke-width="2" bind:this={needle} />
        <circle class="needle-dot" cx="80" cy="90" r="4" />
      </svg>
      <div class="gauge-val"><span class="n">{percent}</span><span class="u">%</span></div>
    </div>
    <div class="gauge-msg mono">{message}</div>
  </div>
  ```
  `ARC = Math.PI * 60`. 바늘: `$effect` 에서 `angle` 이 바뀌면 `needle.animate([{transform: \`rotate(${prev}deg)\`}, {transform: \`rotate(${angle}deg)\`}], {duration, easing: 'ease-in-out', fill: 'forwards'})` 후 `prev = angle`(옛 `_needleToAngle`). `transform-origin: 80px 90px; transform-box: view-box`. `duration` 이 0 이면 animate 대신 `style.transform` 직접 설정.
- 스타일: 문서 885~917 블록. `.gauge { width: 100%; max-width: 160px; aspect-ratio: 160 / 100; height: auto; }`, `.gauge .needle { stroke: var(--ink-0); }`, `.gauge-title { font-family: var(--ff-mono); font-size: var(--fs-xs); letter-spacing: .18em; text-transform: uppercase; color: var(--ink-2); text-align: center; }`, `.gauge-msg { font-size: var(--fs-xs); color: var(--ink-2); text-align: center; }`, `.gauge-val .n { font-size: var(--fs-2xl); }`.

### `admin/src/ui/Loading.svelte`

- props: `overlay = false`, `class`.
- `<div class="loading {overlay ? 'overlay' : ''} {className}" role="status" aria-label="Loading"><img src={loadingImg} alt="" class="spin"></div>`. `loadingImg` 는 `import loadingImg from '../assets/loading.png'`(옛 파일과 같은 자산). 회전은 JS 대신 CSS: `@keyframes spin { to { transform: rotate(360deg); } } .spin { width: 48px; height: 48px; animation: spin 1.6s steps(8) infinite; }`.
- `.loading.overlay { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; background: rgba(14,18,24,.5); }`, `.loading:not(.overlay) { display: inline-flex; }`.
- 옛 `show`·`transition` prop 은 만들지 않는다. 표시 여부는 부모가 `{#if}` 로 정한다.

### `admin/src/ui/Timer.svelte`

- props: `seconds: number`(남은 초), `total: number`(설정된 제한 시간 초, 0 = 무제한), `class`. 콜백 `onchange?: (totalSeconds: number) => void` — 사용자가 설정 모달에서 새 제한 시간을 확정했을 때 그 값(초, 0 = 무제한)을 준다. Timer 는 스스로 세지 않고 부모가 매초 `seconds` 를 준다(일반 prop).
- 마크업:
  ```svelte
  <div class="timer {className}">
    <button type="button" class="timer-text mono" onclick={() => (open = true)}>{total <= 0 ? '∞' : timeString(seconds)}</button>
    <svg class="clock {total <= 0 ? 'infinite' : ''}" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" class="face" />
      <line class="hand" x1="12" y1="12" x2="12" y2="5" style={`rotate: ${deg}deg`} />
    </svg>
    <Modal bind:open title="Tunneling activity restriction time">
      <div class="timer-fields">
        <Field label="Days" for={`${uid}-day`}><NumberInput id={`${uid}-day`} min={0} max={99999} bind:value={day} /></Field>
        <Field label="Hours" for={`${uid}-hour`}><NumberInput id={`${uid}-hour`} min={0} max={23} bind:value={hour} /></Field>
        <Field label="Minutes" for={`${uid}-min`}><NumberInput id={`${uid}-min`} min={0} max={59} bind:value={min} /></Field>
      </div>
      {#snippet footer()}<Button onclick={() => (open = false)}>Cancel</Button><Button variant="primary" onclick={confirm}>OK</Button>{/snippet}
    </Modal>
  </div>
  ```
  `uid = $props.id()`. `deg = total <= 0 ? 95 : Math.floor(95 + (total - Math.min(seconds, total)) / total * (440 - 95))`(옛 `START_DEG`·`END_DEG`). 무제한이면 `.clock.infinite .hand { animation: rotate-hand .5s linear infinite; }`.
- `timeString(left)`: 옛 `_getTimeString` 과 같은 분기·형식, 다만 HTML 없이 순수 문자열("1h 0m 0s", "5m 30s", "0m 0s").
- 모달이 열릴 때 `day/hour/min` 을 `total` 에서 계산해 채운다(`Math.floor(total / 86400)`, `Math.floor(total / 3600) % 24`, `Math.floor(total / 60) % 60`). `confirm`: 각 값이 `null` 이면 0, 각각 max 로 자른 뒤 `next = day*86400 + hour*3600 + min*60`; `next !== total` 이면 `onchange?.(next)`; `open = false`.
- 스타일: `.timer { display: inline-flex; align-items: center; gap: var(--s-2); }`, `.timer-text { background: none; border: 0; padding: 0; text-decoration: underline; cursor: pointer; color: var(--ink-0); font-size: var(--fs-md); }`, `.clock { width: 24px; height: 24px; }`, `.face { fill: var(--bg-0); stroke: var(--ink-0); stroke-width: 2; }`, `.hand { stroke: var(--ink-0); stroke-width: 2; transform-origin: 12px 12px; transform-box: view-box; }`, `.timer-fields { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-3); }`.

### `admin/src/ui/Banner.svelte`

- props: `tone: Tone`, `dismissible = false`, `class`. 스니펫 `children`, 콜백 `ondismiss?: () => void`.
- `<div class="banner {tone} {className}" role="status"><div class="banner-body">{@render children?.()}</div>{#if dismissible}<button type="button" class="banner-close" aria-label="Dismiss" onclick={() => ondismiss?.()}>×</button>{/if}</div>`.
- 스타일(신규): `.banner { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) var(--s-4); border-bottom: 1px solid var(--line-1); border-left: 3px solid var(--line-2); background: var(--bg-3); font-size: var(--fs-sm); }`, tone 별 `border-left-color`: signal/pulse/alarm/trace/warn 은 `var(--{tone})`, neutral 은 `var(--line-2)`.

### `admin/test/UiFixture.svelte` (덧붙임, U1-02 요소 뒤에 이 순서로)

| 요소 | 내용 |
|---|---|
| Modal | `<Button id 없이 onclick={() => (modalOpen = true)}>Open modal</Button>` 를 `<div id="open-modal">` 로 감싼다. `<Modal bind:open={modalOpen} title="Fixture modal"><p>Modal body</p>{#snippet footer()}<Button variant="primary" onclick={() => (modalOpen = false)}>Close modal</Button>{/snippet}</Modal>` |
| Toast | `<div id="toast-push"><Button onclick={() => toast.push({tone: 'pulse', message: 'Fixture toast', timeoutMs: 1500})}>Push toast</Button></div>` 와 페이지 끝의 `<Toast />` |
| Tabs | `<Tabs items={[{id:'one',label:'One'},{id:'two',label:'Two'}]} bind:active={tab} />` (초기 `'one'`) + `<output id="tab-echo">{tab}</output>` |
| Kpi | `<Kpi label="Sessions" value="12" sub="fixture" accent />` |
| Gauge | `<Gauge title="CPU" value={50} max={100} message="50/100%" duration={0} />` |
| Loading | `<Loading />` (오버레이 아님) |
| Timer | `<Timer seconds={60} total={120} onchange={(s) => (timerValue = s)} />` + `<output id="timer-echo">{timerValue}</output>` (초기 `-1`) |
| Banner | `<Banner tone="trace" dismissible ondismiss={() => (bannerShown = false)}>Fixture banner</Banner>` (`bannerShown` 이 true 일 때만) |

### `test/admin/ui-kit.test.ts` (케이스 추가)

수용 기준 참조.

## 변경할 것

- `admin/test/CertificateFixture.svelte`: import 를 `../src/ui/Gauge.svelte`, `../src/ui/Timer.svelte` 로 바꾸고, auxiliary 분기를 `<Gauge value={gaugeValue} max={100} duration={0} title="Auxiliary gauge" message="" />`, `<Timer seconds={timerSeconds} total={timerTotal} />` 로, `updateAuxiliary` 를 `() => { gaugeValue = 50; timerTotal = 120; timerSeconds = 60; }` 로 바꾼다(`let timer: Timer` 와 `bind:this` 삭제). `InputCertFile` 분기와 `export let` 은 이 이슈에서 건드리지 않는다.
- `test/admin/certificate-lifecycle.test.ts` 4번째 케이스: `.percent-box` → `.gauge-val .n`(텍스트 "50"), `.time-text` → `.timer-text`(`/\d+m.*\d+s/` 유지), 언마운트 뒤 `.gauge-val` 개수 0.
- `admin/test/UiFixture.svelte`, `test/admin/ui-kit.test.ts`: 위 덧붙임.

## 하지 말 것

- `component/*.svelte` 삭제·수정 금지(U1-10). `layout/*.svelte` 수정 금지.
- `Timer` 에 `reset()`·`update()` 같은 명령형 메서드를 export 하지 않는다. `<svelte:options accessors/>` 금지.
- `Modal` 을 `<dialog>` 요소로 만들지 않는다(초점·오버레이 규칙을 직접 제어한다).
- `toast` 를 화면 컴포넌트가 아닌 부품 안에서 호출하지 않는다.
- 표에 없는 prop(`Modal size`, `Toast position`, `Gauge min` 등) 추가 금지. 옛 `Gauge` 의 `min`·`style` prop 은 만들지 않는다.
- `infinity.png`, `cpu.png`, `uptime.png` 를 새 부품에서 참조하지 않는다(U1-10 에서 삭제).

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/admin/ui-kit.test.ts` (`ui-fixture.html`, 뷰포트 400×800)
  - "Open modal" 클릭 → `getByRole("dialog", {name: "Fixture modal"})` 이 보이고, `document.activeElement` 가 그 dialog 안에 있다(`dialog.contains(document.activeElement)`).
  - 그 상태에서 `Escape` → dialog 가 사라지고 `document.activeElement` 가 "Open modal" 버튼이다.
  - 다시 열고 "Close modal" 클릭 → 사라진다. 다시 열고 오버레이(`.modal-overlay` 의 좌상단 좌표 `{x: 4, y: 4}`)를 클릭 → 사라진다.
  - "Push toast" 클릭 → `.toast.pulse .msg` 텍스트 "Fixture toast" 가 보이고, 3초 안에 사라진다(`waitFor({state: "hidden", timeout: 3000})`).
  - "Push toast" 를 빠르게 5번 클릭하면 `.toast` 개수가 3 이하이다.
  - 탭 "Two" 클릭 → `#tab-echo` 가 "two", `.tab.active` 의 텍스트가 "Two", `aria-selected="true"`.
  - `.kpi.accent .v` 텍스트가 "12", `.kpi .k` 가 "Sessions".
  - `.gauge-val .n` 텍스트가 "50", `.gauge-msg` 가 "50/100%".
  - `.loading:not(.overlay) img` 가 보인다.
  - `.timer-text` 텍스트가 "1m 0s". 클릭 → `getByRole("dialog", {name: "Tunneling activity restriction time"})` → "Days" 0, "Hours" 0, "Minutes" 5 입력 → "OK" → dialog 사라지고 `#timer-echo` 가 "300". 다시 열어 값을 바꾸지 않고 "OK" → `#timer-echo` 가 그대로 "300"(onchange 미호출).
  - `.banner.trace` 텍스트에 "Fixture banner" 가 있고, "Dismiss" 클릭 → `.banner` 개수 0.
  - `errors` 가 빈 배열이다.
- `test/admin/certificate-lifecycle.test.ts` 4번째 케이스가 새 선택자로 통과한다.

기존 `test/admin/*.test.ts` 전부 통과.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npm --prefix admin run check
npm run test:admin
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U1-02(`Button`·`Field`·`NumberInput`·`tone.ts`).
- 후행: U1-04(`Shell` 이 `Toast`·`Chip` 을 마운트), U1-05~09(화면).

## 근거 문서

- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §6(부품 계약 표와 Modal·Toast 규칙), §8.3(`ui-kit.test.ts`), §9(U1-03)
- `docs/design/2026-09-11-program-overview.md` §1 D2·D3·D5, §3.1·§3.2
- `docs/design/admin-design-system.html` 755~780, 834~882, 885~917, 949~1015, 1942~1990 행

---
## U1-04

**title**: feat(admin): 해시 라우터와 헤더·드로어 골격 추가
**labels**: enhancement, area:frontend, unit:1
**body**:
## 목적

한 페이지에 세 화면을 세로로 쌓던 `App.svelte` 를, 해시 라우터와 헤더·드로어 골격 위에 화면 하나씩 여는 구조로 바꾼다. 이 이슈가 끝나면 `#/status`, `#/tunnels`, `#/tunnels/new`, `#/tunnels/<port>`, `#/server` 경로가 생기고, 기존 레이아웃 3개가 각 경로에 임시로 장착되어 동작한다. 화면 자체의 이식은 U1-05~09.

## 배경

- `admin/src/App.svelte`(121줄): `onMount` 에서 `LoginCtrl.validateSession()` 으로 `_validSession: 'Checking' | 'Valid' | 'Invalid'` 를 정하고(18~23행), `'Valid'` 이면 `<ServerSetLayout/><ServerStatusLayout/><TunnelOptionSetLayout/>` 을 한꺼번에 그린다(43~46행). `'Invalid'` 는 `<Login />`, 그 외(`'Checking'`, 그리고 `validateSession` 이 예외를 던져 값이 바뀌지 않은 경우)는 `<div>Offline server...</div>`(50행). 우하단에 `ServerStatusCtrl.getVersion()` 결과(`{name, build}`)를 `.version-box` 로 고정 표시(56~62행). `<main>` 이 `position: fixed` 로 화면을 고정(110~120행). 사용하지 않는 `generatePastelColor`(28~34행)도 있다. 이 파일을 전면 교체한다.
- `admin/src/main.ts` 는 `mount(App, {target: document.getElementById('app')!})` — 변경 없음.
- `admin/src/layout/Login.svelte` 는 로그인 성공 시 `window.location.href = '/'`(21행)로 새로고침한다. 이 이슈에서는 그대로 둔다(U1-05 가 교체). 새로고침 뒤에도 해시가 남으므로 같은 화면으로 돌아온다.
- 세 레이아웃(`ServerStatusLayout`, `TunnelOptionSetLayout`, `ServerSetLayout`)은 세션 만료를 각자 `AlertLayout` 으로 알린 뒤 `location.href = "/"` 로 처리한다. 이 이슈에서는 손대지 않는다.
- `ServerStatusCtrl.getVersion()`(`admin/src/controller/ServerStatusCtrl.ts` 43~53행)은 `/api/version` 을 `fetch` 해 `{success, name, build}` 를 돌려준다. 백엔드가 없으면 `res.json()` 이 예외를 던진다.
- 브라우저 테스트 기반 `test/helpers/adminBrowser.ts` 의 `startAdminBrowser()` 는 뷰포트를 설정하지 않는다(Playwright 기본 1280×720). 이 이슈의 테스트는 `page.setViewportSize` 를 직접 부른다. 로그인이 필요한 앱 전체 테스트(`startAdminApp`)는 U1-05 가 만든다. 그래서 이 이슈의 골격 테스트는 백엔드 없이 fixture 페이지로 `Shell` 을 마운트한다.
- Jest 는 `test/**/*.test.ts` 를 ts-jest(`isolatedModules: true`, `testEnvironment: node`)로 돌린다(`jest.config.ts`). `admin/src/*.ts` 를 import 하면 ts-jest 가 변환하지만, 그 파일이 `svelte`(ESM 패키지)를 import 하면 CommonJS `require` 가 실패한다. 그러므로 `router.ts` 는 **아무것도 import 하지 않는** 순수 모듈로 만든다.
- 부품 `Chip`(U1-02), `Toast`·`Loading`(U1-03)이 있다.

먼저 열어 볼 파일: `admin/src/App.svelte`, `admin/src/layout/Login.svelte`, `admin/src/controller/ServerStatusCtrl.ts`, `test/helpers/adminBrowser.ts`, `admin/test/certificate.html`, `jest.config.ts`, `test/admin/design-system-rules.test.ts`.

## 적용되는 결정

- D3 모바일 우선. 데스크톱은 `<main>` 최대 너비 1024px 중앙 정렬. 사이드바 없음.
- D4 상단 헤더 + 햄버거 드로어.
- D5 UI 문구 영어 단일.
- D14 동작 변경 없음. 이 이슈가 허용하는 유일한 외양 변화는 "세 화면이 한 페이지에 쌓이던 것이 경로별로 나뉘는 것" 이다.

## 만들 것

### `admin/src/router.ts` (import 없음)

```ts
export type Screen = 'status' | 'tunnels' | 'tunnel-edit' | 'server';
export type Route = {screen: Screen; param?: string};
export function parseHash(hash: string): Route;      // 순수 함수
export const route: {subscribe(run: (value: Route) => void): () => void};  // Svelte store 계약만 맞춘 자체 구현
export function navigate(hash: string): void;        // window.location.hash = hash
```

`parseHash` 규칙(앞의 `#` 는 있어도 없어도 같다):

| 입력 | 결과 |
|---|---|
| `''`, `'#'`, `'#/'`, `'#/status'` | `{screen: 'status'}` |
| `'#/tunnels'` | `{screen: 'tunnels'}` |
| `'#/tunnels/new'` | `{screen: 'tunnel-edit', param: 'new'}` |
| `'#/tunnels/20001'` (1~65535 의 십진 정수, 앞자리 0 없음) | `{screen: 'tunnel-edit', param: '20001'}` |
| `'#/tunnels/0'`, `'#/tunnels/65536'`, `'#/tunnels/abc'`, `'#/tunnels/007'` | `{screen: 'tunnels'}` |
| `'#/server'` | `{screen: 'server'}` |
| `'#/unknown'`, `'#/status/x'`, `'#/server/1'` | `{screen: 'status'}` |

`route` 구현: 모듈 변수 `current = parseHash(location.hash)`, `Set<subscriber>`. `subscribe(run)` 은 즉시 `run(current)` 를 부르고 해제 함수를 돌려준다. 모듈 로드 시 `window.addEventListener('hashchange', …)` 로 `current` 를 갱신하고 구독자에게 통지한다. `typeof window === 'undefined'` 면(Jest) 리스너를 달지 않고 `current = {screen: 'status'}`.

### `admin/src/shell/nav.ts`

```ts
import type {Route, Screen} from '../router';
export const NAV: ReadonlyArray<{hash: string; title: string; screen: Screen}> = [
    {hash: '#/status',  title: 'Status',          screen: 'status'},
    {hash: '#/tunnels', title: 'Tunnels',         screen: 'tunnels'},
    {hash: '#/server',  title: 'Server settings', screen: 'server'},
];
export function chrome(route: Route): {title: string; back?: string};   // 아래 표
export function navScreen(route: Route): Screen;   // 'tunnel-edit' → 'tunnels', 그 외 그대로 (드로어의 현재 항목 판정)
```

| route | title | back |
|---|---|---|
| `status` | `Status` | — |
| `tunnels` | `Tunnels` | — |
| `tunnel-edit`, param `new` | `New tunnel` | `#/tunnels` |
| `tunnel-edit`, param 포트 | `Tunnel <port>` (예: `Tunnel 20001`) | `#/tunnels` |
| `server` | `Server settings` | — |

### `admin/src/shell/session.ts`

```ts
import {getContext, setContext} from 'svelte';
export type SessionContext = {invalidate(): void};
const KEY = 'tttgate:session';
export const provideSession = (ctx: SessionContext) => setContext(KEY, ctx);
export const useSession = (): SessionContext => getContext<SessionContext | undefined>(KEY) ?? {invalidate() {}};
```
`useSession()` 은 컴포넌트 초기화 중에만 부른다. 컨텍스트가 없는 fixture 에서는 아무 일도 하지 않는 객체를 준다.

### `admin/src/shell/Header.svelte`

- props: `title: string`, `back?: string`, `menuOpen = $bindable(false)`, `class`.
- 마크업:
  ```svelte
  <header class="hdr {className}">
    {#if back}
      <button type="button" class="hdr-btn" aria-label="Back" onclick={() => navigate(back)}>{@html ARROW}</button>
    {:else}
      <button type="button" id="menu-button" class="hdr-btn" aria-label="Open menu" aria-expanded={menuOpen} aria-controls="nav-drawer" onclick={() => (menuOpen = true)}>{@html BURGER}</button>
    {/if}
    <h1 class="hdr-title">{title}</h1>
    {#if version}<Chip mono class="hdr-version">{version}</Chip>{/if}
  </header>
  ```
  `ARROW`·`BURGER` 는 모듈 상수 인라인 SVG 문자열(20×20, `stroke="currentColor"`, 화살표 `←` 와 가로선 3개). 외부 파일·URL 없음.
- 버전: `onMount` 에서 `try { const v = await ServerStatusCtrl.getVersion(); version = \`${v.name} ${v.build}\`; } catch { version = ''; }`. `version` 이 빈 문자열이면 칩을 그리지 않는다.
- 스타일: `.hdr { position: sticky; top: 0; z-index: 50; height: 56px; display: flex; align-items: center; gap: var(--s-3); padding: 0 var(--s-2) 0 var(--s-1); background: var(--bg-1); border-bottom: 1px solid var(--line-0); }`, `.hdr-btn { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; background: none; border: 0; border-radius: var(--r-2); color: var(--ink-0); cursor: pointer; }`, `.hdr-title { flex: 1; font-family: var(--ff-display); font-size: var(--fs-xl); font-weight: 500; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`, `.hdr-version { color: var(--ink-2); }`.

### `admin/src/shell/Drawer.svelte`

- props: `open = $bindable(false)`.
- 마크업(열렸을 때만 렌더):
  ```svelte
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="drawer-overlay" onclick={() => (open = false)}></div>
    <nav id="nav-drawer" class="drawer" role="dialog" aria-modal="true" aria-label="Navigation">
      <ul>
        {#each NAV as item (item.hash)}
          <li><a class="drawer-item" href={item.hash} aria-current={navScreen($route) === item.screen ? 'page' : undefined} onclick={() => (open = false)}>{item.title}</a></li>
        {/each}
      </ul>
    </nav>
  {/if}
  <svelte:window onkeydown={(e) => { if (open && e.key === 'Escape') open = false; }} />
  ```
- 초점: `$effect` 에서 `open` 이 true 가 되면 첫 `.drawer-item` 에 `focus()`; cleanup(닫힘)에서 `document.getElementById('menu-button')?.focus()`.
- 라우트 변경 시 닫힘: `$effect(() => { $route; open = false; })` 형태로 `route` 를 구독한다(항목이 `<a href>` 라 해시가 바뀌면 이것으로도 닫힌다).
- 로그아웃 항목 없음.
- 스타일: `.drawer-overlay { position: fixed; inset: 0; z-index: 60; background: var(--ink-0); opacity: .4; }`, `.drawer { position: fixed; top: 0; left: 0; bottom: 0; z-index: 61; width: min(320px, 85vw); background: var(--bg-1); border-right: 1px solid var(--line-1); padding: var(--s-4) 0; animation: drawer-in var(--dur-2) var(--ease-out); }`, `@keyframes drawer-in { from { transform: translateX(-100%); } }`, `.drawer ul { list-style: none; margin: 0; padding: 0; }`, `.drawer-item { display: block; padding: var(--s-3) var(--s-4); border-left: 3px solid transparent; color: var(--ink-1); text-decoration: none; }`, `.drawer-item[aria-current="page"] { border-left-color: var(--signal); color: var(--ink-0); background: var(--bg-3); }`.

### `admin/src/shell/Shell.svelte`

- props: `title: string`, `back?: string`. 스니펫 `children`.
- 마크업: `<Header {title} {back} bind:menuOpen={drawerOpen} /><Drawer bind:open={drawerOpen} /><main class="shell-main">{@render children()}</main><Toast />`. `drawerOpen = $state(false)`.
- 스타일: `.shell-main { width: 100%; max-width: 1024px; margin: 0 auto; padding: var(--s-4) var(--s-4) var(--s-10); }`, `@media (min-width: 640px) { .shell-main { padding: var(--s-6) var(--s-6) var(--s-10); } }`. `position: fixed` 금지. `max-width: 1024px` 는 이 파일에만 존재한다(R4).

### `admin/src/App.svelte` (전면 교체)

```svelte
<script lang="ts">
  type SessionState = 'Checking' | 'Valid' | 'Invalid' | 'Offline';
  let state = $state<SessionState>('Checking');
  provideSession({invalidate() { state = 'Invalid'; }});
  onMount(async () => {
    try { state = (await LoginCtrl.validateSession()) ? 'Valid' : 'Invalid'; }
    catch { state = 'Offline'; }
  });
  $effect(() => { if (state === 'Valid' && location.hash === '') navigate('#/status'); });
  const current = $derived(chrome($route));
</script>
{#if state === 'Checking'}
  <Loading overlay />
{:else if state === 'Offline'}
  <p class="offline">Offline server...</p>
{:else if state === 'Invalid'}
  <Login />
{:else}
  <Shell title={current.title} back={current.back}>
    {#if $route.screen === 'status'}<ServerStatusLayout />
    {:else if $route.screen === 'tunnels' || $route.screen === 'tunnel-edit'}<TunnelOptionSetLayout />
    {:else}<ServerSetLayout />{/if}
  </Shell>
{/if}
```
- `'Offline'` 은 옛 코드에서 `validateSession` 예외 시 "Offline server..." 가 보이던 동작을 그대로 옮긴 것이다.
- `.version-box`, `generatePastelColor`, `<main>` 고정 스타일은 삭제한다(버전은 헤더 칩으로 이동).
- `Login` 은 옛 `layout/Login.svelte` 를 그대로 쓴다(U1-05 가 교체).

### `admin/test/shell-fixture.html` + `admin/test/ShellFixture.svelte` (신규)

`certificate.html` 방식. `ShellFixture.svelte`(룬): `<Shell title={chrome($route).title} back={chrome($route).back}><p id="screen">{$route.screen}{$route.param ? ':' + $route.param : ''}</p></Shell>`. 백엔드 없이 Vite dev 서버만으로 열린다(`/api/version` 은 실패 → 칩 없음).

### `test/admin/router.test.ts` (신규, Jest 단위 테스트)

`import {parseHash} from "../../admin/src/router";` 후 위 표를 `test.each` 로 검사한다. 브라우저 불필요.

### `test/admin/shell.test.ts` (신규)

`startAdminBrowser()` → `page.setViewportSize({width: 400, height: 800})` → `${url}/test/shell-fixture.html#/status`. 케이스는 수용 기준. `finally { await close(); }`, `expect(errors).toEqual([])`.

### `test/admin/design-system-rules.test.ts` (R4 추가)

R4: `admin/src/**/*.{svelte,css,ts}` 중 문자열 `max-width: 1024px` 를 포함하는 파일이 정확히 `admin/src/shell/Shell.svelte` 하나다.

## 변경할 것

- `admin/src/App.svelte`: 위와 같이 전면 교체.
- `test/admin/design-system-rules.test.ts`: R4 추가.
- 그 외 기존 파일 변경 없음. `layout/*.svelte`, `controller/*.ts` 무변경.

## 하지 말 것

- 라우팅 라이브러리(`svelte-spa-router`, `svelte-routing` 등) 추가 금지. `history.pushState` 금지(해시만).
- `router.ts` 에서 `svelte`, `svelte/store` 를 import 하지 않는다(Jest 가 ESM 을 require 하지 못한다).
- `Login.svelte` 의 새로고침 제거 금지(U1-05). 레이아웃 3개 수정 금지.
- 헤더에 로그아웃·계정 메뉴를 만들지 않는다(백엔드에 로그아웃 API 가 없다).
- 드로어를 `transform` 만으로 숨기지 않는다(닫힌 드로어는 DOM 에 없어야 `getByRole("dialog")` 가 사라진다).
- `export let`, `createEventDispatcher`, `on:` 디렉티브 금지. 룬과 스니펫만.
- 데스크톱 전용 사이드바·2단 레이아웃 금지(D3).

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/admin/router.test.ts`
  - 위 `parseHash` 표의 각 행이 입력이면 결과가 `toEqual` 로 일치한다(`#` 유무 두 가지 모두).
- `test/admin/shell.test.ts` (`shell-fixture.html`, 뷰포트 400×800)
  - `#/status` 로 열면 `h1` 텍스트가 "Status" 이고 `#screen` 이 "status" 이다.
  - `getByRole("button", {name: "Open menu"})` 클릭 → `getByRole("dialog", {name: "Navigation"})` 이 보이고 `aria-expanded` 가 "true" 이며, `document.activeElement` 가 텍스트 "Status" 인 `.drawer-item` 이다. `[aria-current="page"]` 의 텍스트가 "Status" 이다.
  - 드로어에서 "Tunnels" 클릭 → `location.hash === '#/tunnels'`, dialog 가 사라지고, `document.activeElement.id === 'menu-button'`, `h1` 이 "Tunnels", `#screen` 이 "tunnels".
  - 메뉴를 다시 열고 `Escape` → dialog 가 사라진다. 다시 열고 `.drawer-overlay` 클릭 → 사라진다.
  - `location.hash = '#/tunnels/20001'` 로 바꾸면 `h1` 이 "Tunnel 20001", `#screen` 이 "tunnel-edit:20001", `getByRole("button", {name: "Back"})` 이 있고 "Open menu" 버튼은 없다. "Back" 클릭 → `#/tunnels`.
  - `location.hash = '#/tunnels/new'` → `h1` "New tunnel". `'#/server'` → "Server settings". `'#/nope'` → "Status".
  - 400px: `main.shell-main` 의 `getBoundingClientRect().width === 400` 이고 `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
  - `setViewportSize({width: 1280, height: 800})` 후 `main.shell-main` 의 너비가 1024 이고 `left === 128`.
  - `.hdr-version` 이 없다(백엔드 없음).
  - `errors` 가 빈 배열이다.
- `test/admin/design-system-rules.test.ts`
  - `max-width: 1024px` 가 `Shell.svelte` 외의 파일에 있으면 실패한다.
- 기존 `test/admin/entrypoint.test.ts` 가 그대로 통과한다(세션 없음 → 옛 `Login` 의 "Sign in" 헤딩, `input[type="password"]` 1개).

기존 `test/admin/*.test.ts` 전부 통과.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npm --prefix admin run check
npm run test:admin
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U1-03(`Chip`, `Toast`, `Loading`).
- 후행: U1-05(LoginScreen 이 `App` 의 `'Invalid'` 분기를 채우고 `startAdminApp` 이 `#/status` 도착을 검증), U1-06~09(각 경로에 새 화면 장착).

## 근거 문서

- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §5.1(router), §5.2(App), §5.3(Shell), §5.4(Header), §5.5(Drawer), §8.1(R4), §8.3(`shell.test.ts`), §9(U1-04)
- `docs/design/2026-09-11-program-overview.md` §1 D3·D4·D5·D14, §3.1·§3.2·§3.3

---
## U1-05

**title**: feat(admin): 관리자 백엔드 테스트 드라이버 일반화와 LoginScreen 이식
**labels**: enhancement, area:frontend, area:test-ci, unit:1
**body**:
## 목적

로그인 화면을 디자인 시스템 부품으로 다시 만들고(`screens/LoginScreen.svelte`), 브라우저 테스트가 "실제 `AdminServer` + 스텁 `TTTServer`" 위에서 로그인까지 마친 앱을 한 호출로 얻을 수 있게 한다(`test/helpers/adminApp.ts` 의 `startAdminApp`). 이 이슈가 끝나면 U1-06~09 의 화면 테스트가 모두 `startAdminApp` 을 쓴다.

## 배경

- 옛 로그인 화면 `admin/src/layout/Login.svelte`(148줄). 옮길 함수: `onClickButton`(11~42행: 빈 비밀번호 검사, `_pending` 가드, `LoginCtrl.login(_password, _bootstrapToken || undefined)`, 결과 분기), `onInputEnter`(44~48행). 문구(그대로 유지):
  - 빈 비밀번호: `Please enter your password.`
  - `status === 429`: `Too many login attempts. Please try again later.`
  - `weakPassword`: `The password does not meet the server's minimum length.`
  - `invalidBootstrapToken && 토큰 입력됨`: `The bootstrap token is invalid. Check config/.bootstrap-token on the server.`
  - `bootstrapRequired`: 토큰 있으면 `Unable to set the first password.`, 없으면 `Enter the bootstrap token to set the first password.`
  - 그 외: `result.message || 'The password is incorrect.'`
  - 예외: `Unable to connect to the server.`
  - 성공 시 `window.location.href = '/'`(21행) — **이 새로고침을 제거한다**(단위 1 에서 허용된 동작 차이 두 가지 중 하나).
  - 요소: 비밀번호 `<input type="password" aria-label="Password">`(57행, id 없음), 토큰 `#bootstrap-token`(60행, `aria-label="Bootstrap token"`, `autocomplete="off"`), 안내 `<small>Read the token from config/.bootstrap-token on the server.</small>`, 메시지 `<div id="login-message" role="alert">`, 버튼 `OK`(`disabled={_pending}`), 헤딩 `<h2>Sign in</h2>`.
- `admin/src/controller/LoginCtrl.ts`: `validateSession()`(16~24행), `login(key, bootstrapToken?)`(26~37행) → `{...json, status, success}`. 변경 없음.
- 옛 드라이버 `test/admin/login-backend-driver.ts`(16줄): `applyTestRoot(argv[2])` → `ServerOptionStore.instance; SessionStore.instance;` → `new AdminServer({} as any, false)` → `listen(0, "127.0.0.1")` → `process.send({port, pid})`; 메시지 `"close"` 를 받으면 `api.close()` 후 `process.disconnect()`. 이 파일을 삭제하고 `admin-backend-driver.ts` 로 대체한다.
- 옛 드라이버를 쓰는 테스트 `test/admin/login-bootstrap.test.ts`: `withLogin`(10~75행)이 `fork(path.join(__dirname, "login-backend-driver.ts"), [root.rootDir], {execArgv: ["-r", "ts-node/register/transpile-only"], …})`(32~34행)로 포크하고, `writeWebFixture` 로 `login.html`(`<div id="login"></div><script type="module" src="${app.url}/test/login.ts">`)과 `index.html`(`Signed in`)을 만들어 백엔드 origin 에서 연다. 케이스 7개가 `getByLabel("Password", {exact: true})`, `getByLabel("Bootstrap token", {exact: true})`, `#login-message`, `getByRole("button", {name: "OK", exact: true})`, 성공 후 `waitForURL(`${origin()}/`)` 을 쓴다. 성공 후 URL 이동은 fixture(`admin/test/login.ts`)가 `onsuccess` 로 수행하게 바꾼다.
- `admin/test/login.ts`(8줄): `mount(Login, {target: document.getElementById('login')!})` 와 `window.loginFixture.login`.
- `AdminServer`(`src/server/admin/AdminServer.ts`)가 `TTTServer` 에 호출하는 메서드(설계 §8.2 의 12개 목록과 같다. 스텁이 전부 제공해야 한다): `captureRuntimeState()`(531·629·715·769·925행), `restoreRuntimeState(state)`(426·435행), `applyServerOption(next, prev)`(549행), `applyTunnelingOption(next, prev?, cert?)`(641·734행), `stopExternalPortServer(port, true)`(735·789행), `externalServerStatus(port)`(787행), `externalServerStatuses()`(1210행), `activeExternalPortServer(port, timeout)`·`inactiveExternalPortServer(port)`(891~892행), `applyExternalServerCert(port, next, prev)`(939행), `getClientSysInfo(id)`(997행), `clientStatus()`(1187행). 반환 타입: `RuntimeApplyResult = {success, partial, warnings: string[], failedScopes: string[], restartRequiredScopes: string[]}`(`src/server/TTTServer.ts` 14~20행), `ExternalPortServerStatus = {port, online, sessions, uptime, active, activeStart, activeTimeout, rx, tx}`(`src/server/ExternalPortServerPool.ts` 31~41행; `uptime` 은 시작 시각 타임스탬프, 150행 `status.uptime = Date.now()`), `ClientStatus = {id, name, clientId, protocolVersion, controlProtocolMode, legacy, uptime, address, activeSessionCount}`(`src/server/TunnelServer.ts` 44~54행; `uptime` 은 경과 ms), `SysInfo = {osInfo: {platform, release, type, hostname}, ram, cpuInfo: {model, speed, cores}, network: {[name]: Array<{address, netmask, family, mac, internal, cidr}>}}`(`src/commons/SysMonitor.ts` 43~57행).
- 비밀번호 저장: `SessionStore`(`src/server/admin/SessionStore.ts`)는 `config/.key` 의 내용을 키로 읽고(62~70행), bcrypt 해시(`$2…`)이면 `bcrypt.compare` 로 검증한다(229행). `.key` 가 없으면 부트스트랩 상태가 되어 `config/.bootstrap-token` 을 만든다. 테스트는 `bcryptjs` 로 `bcrypt.hash(password, 12)` 를 만들어 쓴다(`login-bootstrap.test.ts` 154행).
- 터널 설정 저장: `ServerOptionStore.instance.updateServerOption({...store.serverOption, tunnelingOptions: [...]})` 이 `config/server.yaml` 을 쓴다(`src/server/ServerOptionStore.ts` 192~199행). 검증 규칙은 `verificationTunnelingOption`(414~467행): `forwardPort`·`protocol`·`destinationAddress` 필수, `destinationPort` 없으면 http 80/https 443, `bufferLimitOnClient` 기본 8, `httpOption` 없으면 `{}`. 기존 fixture 예시: `test/component/server/admin/configuration-revision-fixture.ts` 20~22행, `test/admin/csrf-requests.test.ts` 55~58행.
- 인증서 저장소는 `await CertificationStore.instance.load()` 로 초기화한다(`configuration-revision-fixture.ts` 18행). 터널 편집 화면이 `/api/externalCert/:port` 를 부르므로 드라이버도 초기화한다.
- `test/helpers/adminBrowser.ts` 의 `startAdminBrowser({apiOrigin})` 은 Vite dev 서버의 `/api` 를 `apiOrigin` 으로 프록시한다(`admin/test/server.mjs` 10~12행). `test/admin/entrypoint.test.ts` 21~27행이 이 방식으로 실제 `AdminServer` 를 붙여 `app.url` 을 연다.
- 임시 루트: `test/helpers/runtime.ts` 의 `createTestRoot(prefix)`/`cleanupTestRoot(root)`.
- 부품: `Card`, `Field`, `TextInput`, `Button`(U1-02). 골격·세션 컨텍스트: `App.svelte`, `shell/session.ts`, `router.ts`(U1-04).

먼저 열어 볼 파일: `admin/src/layout/Login.svelte`, `admin/src/controller/LoginCtrl.ts`, `admin/src/App.svelte`, `test/admin/login-backend-driver.ts`, `test/admin/login-bootstrap.test.ts`, `admin/test/login.ts`, `test/helpers/adminBrowser.ts`, `test/helpers/runtime.ts`, `test/component/server/admin/configuration-revision-fixture.ts`, `src/server/admin/AdminServer.ts`(위 행), `src/server/TTTServer.ts` 14~20행.

## 적용되는 결정

- D5 UI 문구 영어 단일.
- D13 E2E 는 외부 서비스 없이 자체 스텁·실제 `AdminServer` 로.
- D14 동작 변경 없음. 허용된 예외: 로그인 성공 시 새로고침 제거.
- 프로그램 개요 §3.3: 관리자 UI 브라우저 테스트는 400×800 뷰포트를 기본으로 하는 `startAdminApp` 을 쓴다.

## 만들 것

### `test/admin/admin-backend-driver.ts` (신규, `login-backend-driver.ts` 대체)

- 인자 `process.argv[2] = rootDir`, `process.argv[3] = fixture` (`'bootstrap' | 'password' | 'with-tunnels'`, 기본 `'bootstrap'`). 알 수 없는 값이면 `process.exit(2)`.
- 순서:
  1. `applyTestRoot(rootDir)`.
  2. fixture 가 `'password'` 또는 `'with-tunnels'` 이면 `fs.writeFileSync(path.join(rootDir, 'config', '.key'), bcrypt.hashSync('test-password-1234', 12))`. `'bootstrap'` 이면 쓰지 않는다.
  3. `await CertificationStore.instance.load()`.
  4. fixture 가 `'with-tunnels'` 이면 `ServerOptionStore.instance.updateServerOption({...ServerOptionStore.instance.serverOption, tunnelingOptions: [T1, T2]})` — false 를 돌려주면 throw.
     - T1: `{forwardPort: 20001, protocol: 'tcp', destinationAddress: '127.0.0.1', destinationPort: 9, tls: false, keepAlive: 0, inactiveOnStartup: false, bufferLimitOnServer: 8, bufferLimitOnClient: 8, allowedClientNames: []}`
     - T2: `{forwardPort: 20002, protocol: 'http', destinationAddress: '127.0.0.1', destinationPort: 8080, tls: false, keepAlive: 0, inactiveOnStartup: false, bufferLimitOnServer: 8, bufferLimitOnClient: 8, allowedClientNames: [], httpOption: {rewriteHostInTextBody: true, replaceAccessControlAllowOrigin: false, customRequestHeaders: [], customResponseHeaders: [], bodyRewriteRules: []}}`
     그 외 fixture 는 `ServerOptionStore.instance;` 만 접근한다.
  5. `SessionStore.instance;`
  6. 스텁 `TTTServer` 생성(아래) → `const api = new AdminServer(stub as any, false)` → `const port = await api.listen(0, '127.0.0.1')` → `process.send({port, pid: process.pid})`.
- 스텁: 모듈 변수 `startedAt = Date.now()`, `calls: Array<{method: string; args: unknown[]}> = []`, `active = new Map<number, {active: boolean; activeTimeout: number; activeStart: number}>()`, `OK = () => ({success: true, partial: false, warnings: [], failedScopes: [], restartRequiredScopes: []})`. 모든 메서드는 첫 줄에서 `calls.push({method, args: [...arguments]})` 를 한다(인자는 JSON 직렬화 가능해야 하므로 객체는 그대로 push).

  | 메서드 | 반환 |
  |---|---|
  | `captureRuntimeState()` | `{}` |
  | `restoreRuntimeState()` | `[]` |
  | `applyServerOption()`, `applyTunnelingOption()`, `applyExternalServerCert()` | `OK()` (async) |
  | `stopExternalPortServer(port)` | `true` (async) |
  | `activeExternalPortServer(port, timeout)` | `active.set(port, {active: true, activeTimeout: timeout, activeStart: Date.now()})` 후 `true` (async) |
  | `inactiveExternalPortServer(port)` | `active.set(port, {active: false, activeTimeout: active.get(port)?.activeTimeout ?? 3600, activeStart: active.get(port)?.activeStart ?? startedAt})` 후 `true` (async) |
  | `externalServerStatuses()` | `ServerOptionStore.instance.serverOption.tunnelingOptions.map(o => statusOf(o.forwardPort))` |
  | `externalServerStatus(port)` | 설정에 있으면 `statusOf(port)`, 없으면 `{port, online: false, sessions: 0, rx: 0, tx: 0, uptime: 0, active: false, activeStart: 0, activeTimeout: 0}` |
  | `clientStatus()` | `[{id: 1, name: 'client-a', clientId: 'client-a', protocolVersion: 2, controlProtocolMode: 'legacy', legacy: true, uptime: 65000, address: '127.0.0.1:50000', activeSessionCount: 0}]` |
  | `getClientSysInfo(id)` | `id === 1` 이면 `{osInfo: {platform: 'linux', release: '6.1', type: 'Linux', hostname: 'client-a'}, ram: 8589934592, cpuInfo: {model: 'Fixture CPU', speed: 2400, cores: 4}, network: {eth0: [{address: '10.0.0.2', netmask: '255.255.255.0', family: 'IPv4', mac: '00:11:22:33:44:55', internal: false, cidr: '10.0.0.2/24'}]}}`, 아니면 `undefined` |

  `statusOf(port) = {port, online: true, active: active.get(port)?.active ?? true, sessions: 0, rx: 0, tx: 0, uptime: startedAt, activeStart: active.get(port)?.activeStart ?? startedAt, activeTimeout: active.get(port)?.activeTimeout ?? 3600}`. 설계 §8.2 의 예시 `uptime: 1000` 대신 시작 시각을 쓴다(`ExternalPortServerPool.ts` 150행이 `uptime` 에 `Date.now()` 를 넣고, 화면은 `Date.now() - uptime` 으로 경과를 계산한다).
- IPC: `process.on('message', m)` — `m === 'close'` 이면 `await api.close(); process.disconnect?.()`. `m && m.type === 'calls'` 이면 `process.send({type: 'calls', calls})`.

### `test/helpers/adminApp.ts` (신규)

```ts
export type AdminFixture = 'bootstrap' | 'password' | 'with-tunnels';
export const ADMIN_TEST_PASSWORD = 'test-password-1234';
export type AdminApp = {
    page: Page; url: string;            // Vite dev 서버 origin (앱은 여기서 연다)
    origin: string;                     // 백엔드 origin (http://127.0.0.1:<port>)
    rootDir: string; errors: string[];
    calls(): Promise<Array<{method: string; args: any[]}>>;
    token(): Promise<string>;           // config/.bootstrap-token 내용(trim)
    close(): Promise<void>;
};
export const startAdminApp = async (options: {fixture?: AdminFixture; login?: boolean} = {}): Promise<AdminApp>;
```
- 기본 `fixture: 'password'`, `login: true`.
- 설계 문서와 다른 점: 설계 §8.2 의 반환 `{page, url, errors, calls(), close}` 에 `origin`·`rootDir`·`token()` 을 더했다(부트스트랩 fixture 의 토큰 입력과 `config/` 파일 확인에 필요).
- 순서: `createTestRoot(\`admin-app-${fixture}\`)` → `fork(path.resolve(__dirname, '../admin/admin-backend-driver.ts'), [rootDir, fixture], {execArgv: ['-r', 'ts-node/register/transpile-only'], stdio: ['ignore', 'pipe', 'pipe', 'ipc']})` → stdout/stderr 를 `output` 에 모으고 `{port}` 메시지를 15초 안에 기다린다(옛 `withLogin.startBackend` 37~42행과 같은 방식) → `startAdminBrowser({apiOrigin: origin})` → `page.setViewportSize({width: 400, height: 800})` → `page.goto(url)`.
- `login === true` 이면: `#login-password` 를 기다려 `ADMIN_TEST_PASSWORD` 입력 → "OK" 클릭. fixture 가 `'bootstrap'` 이면 이어서 `#bootstrap-token` 을 기다려 `await token()` 입력 → "OK" 클릭. 그 뒤 `page.waitForFunction(() => location.hash === '#/status')` 와 `h1` 텍스트 "Status" 를 기다린다.
- `calls()`: `child.send({type: 'calls'})` 후 `type === 'calls'` 인 첫 메시지의 `calls` 를 resolve(5초 타임아웃).
- `close()`: 브라우저 `close()` → 드라이버에 `'close'` 전송 후 `exit` 대기(10초 초과 시 `SIGKILL`, exit code 0 이 아니면 `output` 을 담은 Error) → `cleanupTestRoot`. 셋을 `try/finally` 로 중첩해 앞 단계가 실패해도 뒤 단계가 실행되게 한다(옛 `withLogin` 68~74행).
- 시작 도중 실패하면 확보한 자원을 같은 순서로 정리하고 원래 오류를 던진다.

### `admin/src/screens/LoginScreen.svelte` (신규)

- props: `onsuccess: () => void`.
- 상태: `password = $state('')`, `bootstrapToken = $state('')`, `bootstrapRequired = $state(false)`, `message = $state('')`, `pending = $state(false)`.
- `submit(e: SubmitEvent)`: `e.preventDefault()` 후 옛 `onClickButton` 로직을 그대로. 성공이면 `onsuccess()` 호출(새로고침 없음).
- 마크업:
  ```svelte
  <main class="login">
    <Card class="login-card">
      <h1 class="login-title">Sign in</h1>
      <form onsubmit={submit} novalidate>
        <Field label="Password" for="login-password">
          <TextInput id="login-password" type="password" autocomplete="current-password" bind:value={password} />
        </Field>
        {#if bootstrapRequired}
          <Field label="Bootstrap token" for="bootstrap-token" hint="Read the token from config/.bootstrap-token on the server.">
            <TextInput id="bootstrap-token" type="password" autocomplete="off" bind:value={bootstrapToken} />
          </Field>
        {/if}
        <p id="login-message" role="alert" class="login-message">{message}</p>
        <div class="login-actions"><Button type="submit" variant="primary" disabled={pending}>OK</Button></div>
      </form>
    </Card>
  </main>
  ```
  Enter 제출은 `<form>` 의 기본 동작으로 얻는다(`onInputEnter` 불필요).
- 스타일: `.login { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: var(--s-4); }`, `.login-card { width: 100%; max-width: 400px; }`, `.login-title { font-family: var(--ff-display); font-size: var(--fs-2xl); margin: 0 0 var(--s-5); }`, `form { display: flex; flex-direction: column; gap: var(--s-4); }`, `.login-message { min-height: 1.5em; margin: 0; color: var(--alarm); font-size: var(--fs-sm); }`, `.login-actions { display: flex; justify-content: flex-end; }`.

### `test/admin/screen-login.test.ts` (신규)

`startAdminApp({fixture, login: false})` 로 열어 케이스를 검증한다(수용 기준). 각 케이스 `finally { await app.close(); }`, `expect(app.errors).toEqual([])`. 타임아웃 60_000.

## 변경할 것

- `admin/src/App.svelte`: `import Login from './layout/Login.svelte'` → `import LoginScreen from './screens/LoginScreen.svelte'`; `'Invalid'` 분기를 `<LoginScreen onsuccess={() => (state = 'Valid')} />` 로.
- `admin/test/login.ts`: `mount(LoginScreen, {target: document.getElementById('login')!, props: {onsuccess: () => { location.href = '/'; }}})`. `loginFixture.login` 유지.
- `test/admin/login-bootstrap.test.ts` 32행: `"login-backend-driver.ts"` → `"admin-backend-driver.ts"`, 인자 `[root.rootDir, "bootstrap"]`. 그 외 변경 없음(7개 케이스는 그대로 통과해야 한다).
- 삭제: `admin/src/layout/Login.svelte`, `test/admin/login-backend-driver.ts`.

## 하지 말 것

- `LoginCtrl.ts`, `AdminRequest.ts` 수정 금지. 백엔드(`src/`) 수정 금지.
- 로그인 성공 후 `location.href`·`location.reload()` 호출 금지(앱 코드에서). fixture `login.ts` 의 이동은 테스트 호환용이며 허용.
- 문구를 바꾸거나 합치지 않는다. 기존 7개 문구를 그대로 쓴다.
- 드라이버의 스텁을 실제 `TTTServer` 로 바꾸지 않는다(포트 바인딩·클라이언트 없이 결정적으로 동작해야 한다).
- `startAdminApp` 에 `fixture` 외의 옵션(임의 터널 목록, 비밀번호 지정 등)을 추가하지 않는다.
- `export let`, `createEventDispatcher`, `on:keyup` 금지.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/admin/screen-login.test.ts`
  - (`bootstrap`, `login: false`) `page.on('load')` 카운터를 `goto` 뒤에 단다. "OK" 만 누르면 `#login-message` 가 "Please enter your password." 이다.
  - `#login-password` 에 "short" → "OK" → `#login-message` 가 "The password does not meet the server's minimum length." 이다.
  - "plainword" → "OK" → `#bootstrap-token` 이 보이고(`getByLabel("Bootstrap token", {exact: true})`), `#login-message` 가 "Enter the bootstrap token to set the first password." 이며, 안내 문구 "Read the token from config/.bootstrap-token on the server." 가 보인다.
  - 토큰 "wrong-token" → "OK" → `#login-message` 가 "The bootstrap token is invalid. Check config/.bootstrap-token on the server." 이다.
  - 올바른 토큰(`await app.token()`) → "OK" → `location.hash === '#/status'`, `h1` 이 "Status", `load` 카운터가 0(새로고침 없음), `errors` 가 빈 배열.
  - (`password`, `login: false`) "wrong-password" → "OK" → `#login-message` 가 "The password is incorrect." 이다. `ADMIN_TEST_PASSWORD` → "OK" → `#/status`.
  - (`password`, `login: false`) 비밀번호 입력란에서 `Enter` 를 누르면 제출된다(`waitForResponse` 로 `POST /api/login` 1건).
  - (`with-tunnels`) `startAdminApp()` 기본 호출만으로 `#/status` 에 도착하고 `calls()` 가 배열을 돌려준다.
- `test/admin/login-bootstrap.test.ts` 7개 케이스가 새 드라이버·새 `LoginScreen` 으로 그대로 통과한다.
- `test/admin/entrypoint.test.ts`: "Sign in" 헤딩과 `input[type="password"]` 1개 — 그대로 통과.

기존 `test/admin/*.test.ts` 전부 통과.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npm --prefix admin run check
npm run test:admin
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U1-04(`App.svelte` 골격, `router.ts`).
- 후행: U1-06·07·08·09(모든 화면 테스트가 `startAdminApp` 과 `calls()` 를 쓴다), U2-10(로그인 UI 의 username 전환은 이 화면이 끝난 뒤).

## 근거 문서

- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §5.2(App·새로고침 제거), §7.1(LoginScreen), §8.2(드라이버·`startAdminApp`), §8.3(`screen-login.test.ts`), §9(U1-05)
- `docs/design/2026-09-11-program-overview.md` §1 D5·D13·D14, §3.3 테스트 규약(400×800), §3.4 API 응답 규약

---
## U1-06

**title**: feat(admin): StatusScreen 과 SysinfoPopup 을 디자인 시스템으로 이식
**labels**: enhancement, area:frontend, unit:1
**body**:
## 목적

서버 상태 화면을 `screens/StatusScreen.svelte` 로 다시 만들어 `#/status` 에 장착하고, 옛 `layout/ServerStatusLayout.svelte`·`layout/SysinfoPopup.svelte` 를 지운다. 이 이슈가 끝나면 게이지 4개·가동 시간·클라이언트 목록·시스템 정보 모달이 새 부품으로 동작하고 브라우저 테스트가 이를 고정한다.

## 배경

- 옛 화면 `admin/src/layout/ServerStatusLayout.svelte`(220줄). 옮길 함수와 위치:
  - `_startStatusUpdate`(34~43행): 즉시 1회 `_loadServerStatus()`, 이후 `setInterval` 1000ms. 콜백이 false 를 돌려주면 `clearInterval`.
  - `_loadServerStatus`(45~57행): `getSysUsage()` 와 `getClientStatus()` 를 순서대로 `await`. 성공이면 true. 예외가 `InvalidSession` 이면 `_sessionOut()`; **어떤 예외든 false 를 돌려 폴링이 멈춘다**(설계 §7.2 는 "그 외 실패는 interval 유지" 라고 적었으나 소스는 멈춘다. D14 에 따라 소스를 따른다).
  - `_sessionOut`(59~63행): "Session is expired.<br/>Please login again." 알림 → OK → `location.href = "/"`. 새 화면에서는 OK → `session.invalidate()`.
  - `_alert`(65~78행): 메시지·버튼 문구·닫힘 콜백을 받아 `AlertLayout` 표시.
  - `_byteToUnit`(80~96행): TiB/GiB/MiB/KiB/B, `ExMath.round(x, 1)`. `layout/SysinfoPopup.svelte` 22~38행에 같은 함수가 중복돼 있다 → 한 곳으로 모은다.
  - `onClickShowInfo`(98~105행): `getSysInfo()` → 팝업. 실패 시 `_alert(e + '')`.
  - `onClickShowClientSysInfo`(108~118행): `getClientSysInfo(id)` → 팝업. `Error` 면 `_alert(e.message)`.
  - `_timeToDMH`(120~127행): ms → `{d}d {h}h {m}m {s}s`.
  - 마크업(131~199행): "INFO" 링크(`cpu.png` 아이콘) + 가동 시간(`uptime.png` 아이콘), 게이지 4개(CPU `value=cpu.process`, `message=\`${cpu.process}/${cpu.total}%\``; Memory `value=memory.process, max=memory.total`; Heap `heap.used/heap.total`; Buffer `totalBuffer.used/totalBuffer.total`; 모두 `duration=900`), "Client list" 아래 클라이언트마다 `ID: {id}`(밑줄, 클릭 시 클라이언트 정보), `{name}`, `Address`, `Uptime`(`_timeToDMH`), `Active session`.
- 옛 팝업 `admin/src/layout/SysinfoPopup.svelte`(143줄): "HW Info"(CPU `cpuInfo.model`, Clock `cpuInfo.speed`, Cores `cpuInfo.cores`, RAM `_byteToUnit(ram)`), "OS Info"(Type `osInfo.type`, Platform, Release, hostname), "Network"(인터페이스 이름마다 address/netmask/mac/internal/family/cidr 목록). 버튼 문구 `button` prop 기본 'Ok'.
- **컨트롤러 결함(소스 기준으로 고친다)**: `admin/src/controller/ServerStatusCtrl.ts` 의 `getSysUsage`(28~40행)·`getSysInfo`(55~69행)·`getClientSysInfo`(71~93행)·`getClientStatus`(96~107행)는 응답 봉투 전체를 돌려주지만, `AdminServer` 는 데이터를 `{success, sysUsage}`(`src/server/admin/AdminServer.ts` 1180행), `{success, sysInfo}`(1172행·1002행), `{success, statuses}`(1188행) 로 감싼다. 그래서 옛 화면은 `_usage.cpu.process` 에서 TypeError 가 나고 `{#each _clientStatuses}` 가 객체를 순회하려 한다. 설계 §2 는 컨트롤러 층을 그대로 쓴다고 했으나 이 네 메서드는 봉투를 풀어야 화면이 렌더된다. 이 이슈에서 반환문만 고친다.
- 타입 `admin/src/controller/Types.ts`: `Usage`, `SysInfo`, `ClientStatus`, `NetworkInterface`. 변경 없음.
- 스텁 백엔드(U1-05 드라이버): `clientStatus()` 가 `{id: 1, name: 'client-a', address: '127.0.0.1:50000', uptime: 65000, activeSessionCount: 0, …}` 1건, `getClientSysInfo(1)` 이 `cpuInfo.model === 'Fixture CPU'` 인 고정 값. `/api/sysUsage`·`/api/sysInfo` 는 드라이버 프로세스의 실제 `SysMonitor` 값.
- 부품: `Button`, `Chip`, `Card`(U1-02), `Gauge`, `Modal`, `Loading`(U1-03). 세션 컨텍스트 `shell/session.ts` 의 `useSession()`(U1-04). 앱 테스트 `startAdminApp`(U1-05).
- `admin/src/assets/cpu.png`, `uptime.png` 는 이 화면만 썼다. 새 화면은 쓰지 않는다(삭제는 U1-10).

먼저 열어 볼 파일: `admin/src/layout/ServerStatusLayout.svelte`, `admin/src/layout/SysinfoPopup.svelte`, `admin/src/controller/ServerStatusCtrl.ts`, `admin/src/controller/Types.ts`, `admin/src/App.svelte`, `test/helpers/adminApp.ts`, `test/admin/admin-backend-driver.ts`.

## 적용되는 결정

- D2 디자인 시스템으로 전면 재작성.
- D3 모바일 우선(게이지 2열, 640px 이상 4열).
- D5 UI 문구 영어 단일.
- D14 동작 변경 없음(폴링 주기·실패 처리·모달 내용 동일).

## 만들 것

### `admin/src/screens/parts/units.ts` (신규)

```ts
import ExMath from '../../controller/ExMath';
export const byteToUnit = (length: number, hideUnit = false): string => …;   // 옛 _byteToUnit 그대로
export const timeToDMH = (ms: number): string => …;                          // 옛 _timeToDMH 그대로: `${d}d ${h}h ${m}m ${s}s`
```
U1-08 이 같은 파일에 `startupTime`, `toSize` 를 추가한다.

### `admin/src/screens/parts/SysinfoPopup.svelte` (신규)

- props: `open = $bindable(false)`, `sysInfo: SysInfo | undefined`.
- `<Modal bind:open title="System info">` 안에 옛 팝업과 같은 세 절을 `<h3>` "HW Info" / "OS Info" / "Network" 와 `<dl>`(각 항목 `<dt>`/`<dd>`)로 그린다. 항목 이름과 값은 옛 팝업과 같다(CPU, Clock, Cores, RAM / Type, Platform, Release, hostname / 인터페이스별 address, netmask, mac, internal, family, cidr). 푸터: `<Button variant="primary" onclick={() => (open = false)}>OK</Button>`. `sysInfo` 가 없으면 본문을 비운다.
- 스타일: `h3 { font-family: var(--ff-ui); font-size: var(--fs-sm); letter-spacing: .12em; text-transform: uppercase; color: var(--ink-2); margin: var(--s-4) 0 var(--s-2); }`, `dl { display: grid; grid-template-columns: max-content 1fr; gap: var(--s-1) var(--s-3); margin: 0; }`, `dd { margin: 0; font-family: var(--ff-mono); word-break: break-all; }`.

### `admin/src/screens/StatusScreen.svelte` (신규)

- 상태: `usage = $state<Usage | undefined>()`, `clients = $state<ClientStatus[]>([])`, `sysInfo = $state<SysInfo | undefined>()`, `infoOpen = $state(false)`, `alertOpen = $state(false)`, `alertMessage = $state('')`, `intervalId`.
- `const session = useSession();` — 컨텍스트가 없으면 no-op 이므로 이 화면은 `Shell` 없이 `mount(StatusScreen, {target})` 로 단독 마운트할 수 있어야 한다(fixture 규칙).
- `onMount(() => { startStatusUpdate(); return () => clearInterval(intervalId); })` — 옛 `_startStatusUpdate`·`_loadServerStatus` 로직 그대로. `InvalidSession` 이면 `alert('Session is expired. Please login again.', () => session.invalidate())`.
- `showInfo()`·`showClient(id)`: 옛 `onClickShowInfo`·`onClickShowClientSysInfo` 그대로(성공 시 `sysInfo = …; infoOpen = true`).
- `alert(message, onClose?)`: `alertMessage = message; alertOpen = true; alertClose = onClose ?? (() => {})`.
- 마크업:
  ```svelte
  <div class="status">
    <div class="status-bar">
      <Button variant="ghost" size="sm" onclick={showInfo}>INFO</Button>
      {#if usage}<Chip mono class="status-uptime">{timeToDMH(usage.uptime)}</Chip>{/if}
    </div>
    {#if usage}
      <div class="gauges">
        <Gauge title="CPU" value={usage.cpu.process} max={100} message={`${usage.cpu.process}/${usage.cpu.total}%`} />
        <Gauge title="Memory" value={usage.memory.process} max={usage.memory.total} message={`${byteToUnit(usage.memory.process)}/${byteToUnit(usage.memory.total)}`} />
        <Gauge title="Heap" value={usage.heap.used} max={usage.heap.total} message={`${byteToUnit(usage.heap.used)}/${byteToUnit(usage.heap.total)}`} />
        <Gauge title="Buffer" value={usage.totalBuffer.used} max={usage.totalBuffer.total} message={`${byteToUnit(usage.totalBuffer.used)}/${byteToUnit(usage.totalBuffer.total)}`} />
      </div>
    {/if}
    <h2 class="section-title">Client list</h2>
    {#if clients.length === 0}
      <p class="empty">No clients connected.</p>
    {:else}
      <ul class="client-list">
        {#each clients as client (client.id)}
          <li>
            <div class="client-tap" role="button" tabindex="0" aria-label={`Client ${client.id} details`}
                 onclick={() => showClient(client.id)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showClient(client.id); } }}>
              <Card label={`ID: ${client.id}`}>
                <h3 class="client-name">{client.name}</h3>
                <dl class="client-meta"><dt>Address</dt><dd>{client.address}</dd><dt>Uptime</dt><dd>{timeToDMH(client.uptime)}</dd><dt>Active session</dt><dd>{client.activeSessionCount}</dd></dl>
              </Card>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
    <SysinfoPopup bind:open={infoOpen} {sysInfo} />
    <Modal bind:open={alertOpen} title="Status">{alertMessage}{#snippet footer()}<Button variant="primary" onclick={() => { alertOpen = false; alertClose(); }}>OK</Button>{/snippet}</Modal>
  </div>
  ```
- 스타일: `.status-bar { display: flex; align-items: center; gap: var(--s-3); margin-bottom: var(--s-4); }`, `.gauges { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--s-4); }`, `@media (min-width: 640px) { .gauges { grid-template-columns: repeat(4, 1fr); } }`, `.section-title { font-family: var(--ff-display); font-size: var(--fs-lg); margin: var(--s-6) 0 var(--s-3); }`, `.empty { color: var(--ink-2); }`, `.client-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-3); }`, `.client-tap { cursor: pointer; border-radius: var(--r-2); }`, `.client-tap:focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; }`, `.client-name { font-family: var(--ff-ui); font-size: var(--fs-lg); margin: 0 0 var(--s-2); }`, `.client-meta { display: grid; grid-template-columns: max-content 1fr; gap: var(--s-1) var(--s-3); margin: 0; font-size: var(--fs-sm); }`, `.client-meta dd { margin: 0; font-family: var(--ff-mono); }`.

### `test/admin/screen-status.test.ts` (신규)

`startAdminApp()`(기본 `password` fixture, 로그인 완료, `#/status`). 케이스는 수용 기준. `finally { await app.close(); }`, `expect(app.errors).toEqual([])`. 타임아웃 60_000.

## 변경할 것

- `admin/src/controller/ServerStatusCtrl.ts`: `getSysUsage` 의 `return json;` → `return json.sysUsage;`(캐시 줄 `this._sysInfoCache = json.system;` 삭제), `getSysInfo` 의 `this._sysInfoCache = json.system; return json;` → `this._sysInfoCache = json.sysInfo; return json.sysInfo;`, `getClientSysInfo` 의 `sysInfo = json as SysInfo;` → `sysInfo = json.sysInfo as SysInfo;` 와 `return json;` → `return sysInfo;`, `getClientStatus` 의 `this._sysInfoCache = json.system; return json;` → `return json.statuses;`. 그 외 줄은 건드리지 않는다.
- `admin/src/App.svelte`: `status` 분기를 `<StatusScreen />` 으로. `ServerStatusLayout` import 삭제.
- 삭제: `admin/src/layout/ServerStatusLayout.svelte`, `admin/src/layout/SysinfoPopup.svelte`.

## 하지 말 것

- 폴링 주기(1초)·실패 시 중단 동작을 바꾸지 않는다. 실패 재시도·백오프 추가 금지.
- `ServerStatusCtrl` 의 다른 메서드(`getVersion`, 캐시 로직)를 손대지 않는다. `_versionInfo` 캐시가 채워지지 않는 결함은 코멘트로 보고만 한다.
- `cpu.png`, `uptime.png` 를 새 화면에서 import 하지 않는다. 삭제도 하지 않는다(U1-10).
- `Kpi` 로 게이지를 대체하지 않는다(게이지는 `Gauge`).
- `layout/TunnelOptionSetLayout.svelte`, `layout/ServerSetLayout.svelte` 수정 금지.
- `export let`, `createEventDispatcher`, `on:` 디렉티브, `{@html}` 금지(옛 `<br/>` 메시지는 공백으로 이어 붙인 순수 문자열로).

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/admin/screen-status.test.ts` (`startAdminApp()`, `#/status`)
  - `.gauge-title` 4개의 텍스트가 순서대로 "CPU", "Memory", "Heap", "Buffer" 이다(첫 폴링 뒤 나타나므로 `waitFor` 로 기다린다).
  - `.gauge-msg` 첫 번째 텍스트가 `/^\d+(\.\d+)?\/\d+(\.\d+)?%$/` 에 맞는다.
  - `.status-uptime` 텍스트가 `/^\d+d \d+h \d+m \d+s$/` 에 맞는다.
  - "INFO" 클릭 → `getByRole("dialog", {name: "System info"})` 안에 "HW Info", "OS Info", "Network" 헤딩이 있다 → "OK" → dialog 사라짐.
  - 클라이언트 카드가 1개이고 "ID: 1", "client-a", "127.0.0.1:50000", "Active session" 이 보인다. `Uptime` 값이 "0d 0h 1m 5s" 이다.
  - `getByRole("button", {name: "Client 1 details"})` 클릭 → dialog 안에 "Fixture CPU" 와 "eth0" 이 있다 → "OK" → 사라짐. `calls()` 에 `{method: 'getClientSysInfo', args: [1]}` 가 있다.
  - `page.on('request')` 로 `/api/sysUsage` 요청 수를 세면 2초 동안 2건 이상 늘어난다. `location.hash = '#/server'` 로 이동한 뒤 1.5초 동안은 0건 늘어난다(언마운트 시 `clearInterval`).
  - `errors` 가 빈 배열이다.
- 옛 `layout/ServerStatusLayout.svelte` 가 없다(`fs.existsSync` false) — `design-system-rules.test.ts` 에 넣지 않고 이 테스트 파일의 첫 케이스로 둔다.

기존 `test/admin/*.test.ts` 전부 통과.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npm --prefix admin run check
npm run test:admin
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U1-05(`startAdminApp`, 드라이버 스텁의 `clientStatus`·`getClientSysInfo`).
- 후행: U1-10(`cpu.png`·`uptime.png` 삭제, `layout/` 디렉터리 제거 확인). U1-07·U1-08 과는 독립(서로 다른 파일)이라 병렬 가능하되 `App.svelte` 의 분기 한 줄만 각자 바꾼다.

## 근거 문서

- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §7.2(StatusScreen), §8.3(`screen-status.test.ts`), §9(U1-06)
- `docs/design/2026-09-11-program-overview.md` §1 D2·D3·D5·D14, §3.4 API 응답 규약(봉투 형태)

---
## U1-07

**title**: feat(admin): ServerSettingsScreen 과 InputCertFile 을 디자인 시스템으로 이식
**labels**: enhancement, area:frontend, unit:1
**body**:
## 목적

서버 설정 화면을 `screens/ServerSettingsScreen.svelte` 로, 인증서 파일 입력 부품을 `screens/parts/InputCertFile.svelte`(Svelte 5 룬)로 다시 만들어 `#/server` 에 장착하고 옛 `layout/ServerSetLayout.svelte`·`layout/InputCertFile.svelte` 를 지운다. 인증서 입력을 쓰는 기존 브라우저 테스트 5개 파일이 새 부품으로 그대로 통과해야 한다.

## 배경

- 옛 화면 `admin/src/layout/ServerSetLayout.svelte`(271줄). 옮길 함수:
  - `onMount`(31~57행): `getServerOption()` → `_serverOption`·`_snapshotRevision`, `getServerOptionHash()`, `_lastServerOption = cloneDeep`, `loadAdminCert()` → `_adminServerCert`·`_lastAdminCert`·`_originalAdminCert`. 예외: `InvalidSession` → `_sessionOut()`, 그 외 `_alert("Unable to connect to the server.", "OK", () => location.href = "/")`.
  - `$:` `_isNewValue`(59~61행): `!equalsDeep(_serverOption, _lastServerOption) || _adminServerCert == null || _lastAdminCert == null || !equalsDeep(_adminServerCert, _lastAdminCert)`.
  - `_enforceMinMax`(66~76행): keyup 에서 값을 `min`·`max` 로 자른다.
  - `_onUpdateAdminCert`·`_updateAdminCert`(78~105행): `updateAdminCert(cert)` 성공 시 `_lastAdminCert = _adminServerCert; _adminServerCert = newCert`, 실패 시 `_alert(result.message)`, 예외 시 `InvalidSession` → `_sessionOut()`, 그 외 "Unable to connect to the server." + "Retry" 버튼 → 재시도.
  - `_alert`(107~120행), `_apply`(123~144행: `updateServerOption(_serverOption, _snapshotRevision)` 성공 → `_checkServerRestart()`, 실패 → `_alert(result.message)`, 예외 → 세션/재시도), `_checkServerRestart`(146~176행: `checkChangeServerOption(_lastServerOption, _serverOption)`; 예외 → "Error: Server status could not be determined." (+ adminTls 면 "(It could be a TSL certificate error.)") → OK → 새 admin 주소로 이동; true → "Server settings have been changed.<br/>The server has been restarted." → OK → 스냅샷 갱신 후 새 admin 주소로 이동; false → "New server options cannot be applied." → OK → 값 되돌리고 `location.href = '/'`), `_reset`(178~185행: `_serverOption = cloneDeep(_lastServerOption); _adminServerCert = cloneDeep(_originalAdminCert)`; 인증서가 바뀌어 있었으면 `_updateAdminCert`), `_sessionOut`(188~192행).
  - 마크업(197~258행) 필드: `#input-key`("Tunnel server-client authentication key"), `#input-admin-port`(number 0~65535, "Admin service port number"), admin TLS 체크박스(id 없음, 문구 "Secure tunneling Server/Client" — 터널 TLS 문구를 복사한 오기), `{#if adminTls}<InputCertFile certInfo={_adminServerCert} on:update>`, `#input-tunnel-port`(0~65535, "Tunnel server port number"), 터널 TLS 체크박스("Enable secure Tunnel server"), `globalMemCacheLimit`(number 1~99999, "Total buffer size limit (MiB)", id 없음), `keepAlive`(number 1~99999, "Keep Alive (ms. If <= 0, it is disabled)", id 없음), 버튼 "Apply"(`disabled={!_isNewValue}`), "Reset".
- 옛 부품 `admin/src/layout/InputCertFile.svelte`(381줄, `export let hideMessage`, `width = 250`, `certInfo`, `dispatch('update', clone)`). 옮길 함수: `_syncCertInfo`(50~59행, `$:` 로 prop 변화 감시 → `_lastCertInfo` 와 다르면 갱신 후 `_resetInputFile`), `_updateCertInfo`(66~73행), `_resetInputFile`(91~109행: 세 `<input type="file">` 의 `files` 를 `DataTransfer` 로 채우거나 비움), `_clearKeyAndCert`(112~125행), `_pemDataToDataTransfer`(128~133행), `_textToBLob`(135~137행), `_validKeyPair`(151~174행, `node-forge` RSA-OAEP 왕복, `randomHex(64)`), `_isValidCertificate`(176~191행), `_isValidPrivateKey`(194~210행), `_checkTypeAndSet`(212~232행: 검사 실패 시 "Invalid private key"/"Invalid certificate" 알림 후 복원), `_onInputFile`(235~250행), `_checkKeyPair`(252~262행: 'Success'|'Fail'|'NoCondition', Fail 이면 "Invalid Key Pair" 알림), `_readFileToString`(264~274행), `_onClickRemoveCa`(276~285행). `enforceMinMax`(139~149행)는 파일 입력에 걸린 죽은 코드 → 옮기지 않는다. 마크업(289~318행): Key·Cert·CA 파일 입력 3개(`accept=".pem, *.crt, *.cer"`, 고정 `width` px), CA 옆 "X" 버튼, `hideMessage === false` 일 때 안내 2줄 "If you do not upload a cert, a random key will be used." / "If an incorrect cert is uploaded, it will work with HTTP.", `AlertLayout`(버튼 기본 문구 'Ok').
  - 옛 부품은 prop `certInfo` 를 직접 변이한다(`certInfo = cloneDeep(...)`, `certInfo!.key.name = ''`). 룬에서는 prop 을 변이하지 않고 내부 상태만 바꾼다. `_clearKeyAndCert` 가 부모 객체를 비우던 부수 효과는 사라지며, 부모는 다음 `onupdate` 까지 이전 쌍을 유지한다(서버로는 유효한 쌍만 전송되므로 결과는 같다). 이 차이를 이슈 코멘트로 보고한다.
- 옛 부품을 쓰는 곳: `layout/ServerSetLayout.svelte` 219행, `layout/TunnelOptionSetLayout.svelte` 11행 import·532행 `<InputCertFile certInfo={option.certInfo} on:update={(e) => {option.certInfo = e.detail}} hideMessage={true}>`(이 파일은 U1-09 까지 남으므로 새 부품 API 로 고쳐 연결한다), `admin/test/CertificateFixture.svelte` 2행·32~33행.
- 기존 테스트가 쓰는 선택자·문구: `test/admin/certificate-lifecycle.test.ts` — `input[type="file"]` 3개, "Parent redraw" 버튼, `getByText("Invalid certificate", {exact: true})`, `getByRole("button", {name: "Ok", exact: true})`(33행 → "OK" 로 바꾼다), `#updates`, `#certificate`, `window.certificateFixture.replace/mutate/updateAuxiliary`, `window.unmountFixture`, `window.initialCertificate`; `test/admin/configuration-editor.test.ts` — `configurationFixture.mount("server")`, `#input-admin-port`, "Apply" 버튼, `getByText(/Configuration changed/)`; `test/admin/compound-stale-rename.test.ts` 와 `configuration-certificate-conflict.discovery.test.ts` — `input[type="file"]`, "Invalid Key Pair", "Ok" 버튼(31행 → "OK"); `test/admin/crypto-replacement.test.ts` 12행 — `admin/src/layout/InputCertFile.svelte` 경로를 읽어 `randomHex(64)` 포함 여부 검사(경로를 새 파일로 바꾼다).
- `admin/test/configuration.ts`(11줄): `mount(kind === 'server' ? ServerSetLayout : TunnelOptionSetLayout, {target: document.body})`.
- 부품: `Card`, `Field`, `TextInput`, `NumberInput`, `Checkbox`, `Button`(U1-02), `Modal`, `Loading`(U1-03). `useSession()`(U1-04). `startAdminApp`(U1-05). 컨트롤러 `ServerOptionCtrl`, `CertificationCtrl`, `ObjectUtil`, `lodash` — 변경 없음.

먼저 열어 볼 파일: `admin/src/layout/ServerSetLayout.svelte`, `admin/src/layout/InputCertFile.svelte`, `admin/src/layout/TunnelOptionSetLayout.svelte`(11·532행), `admin/test/CertificateFixture.svelte`, `admin/test/configuration.ts`, 위 테스트 5개, `admin/src/controller/ServerOptionCtrl.ts`, `admin/src/controller/CertificationCtrl.ts`.

## 적용되는 결정

- D2 디자인 시스템으로 전면 재작성. D3 모바일 우선(파일 입력 `width: 100%`).
- D5 UI 문구 영어 단일.
- D14 동작 변경 없음(저장·재시작 확인·재로그인 흐름 동일).

## 만들 것

### `admin/src/screens/parts/InputCertFile.svelte` (신규, 룬)

- props: `certInfo: CertInfo | null | undefined`, `hideMessage = false`, `class`. 콜백 `onupdate?: (value: CertInfo) => void`.
- 내부 상태: `lastCertInfo`(부모가 마지막으로 준 값의 사본), `tempCertInfo = $state(...)`(편집 중 값), 파일 입력 요소 3개(`bind:this`), `alertOpen`, `alertMessage`.
- `$effect(() => { sync(certInfo); })` — 옛 `_syncCertInfo`: `certInfo` 가 null/undefined 면 빈 `CertInfo` 로 간주. `lastCertInfo` 와 `equalsDeep` 이 아니면 `lastCertInfo = clone; tempCertInfo = clone; resetInputFile()`. 같으면 아무 것도 하지 않는다(편집 중 값 보존).
- `updateCertInfo()`: `equalsDeep(lastCertInfo, tempCertInfo)` 가 아니면 `onupdate?.(cloneDeep(tempCertInfo))`; 그 뒤 `lastCertInfo = cloneDeep(tempCertInfo)`.
- 나머지 함수는 옛 코드 그대로(위 목록). `_clearKeyAndCert` 는 `tempCertInfo` 의 key·cert 와 두 입력만 비운다(prop 변이 없음). `onMount` 에서 `resetInputFile()`.
- 마크업:
  ```svelte
  <div class="cert-files {className}">
    <Field label="Key" for={`${uid}-key`}><input class="input" type="file" id={`${uid}-key`} accept=".pem,.crt,.cer" oninput={(e) => onInputFile(e, 'private')} bind:this={keyEl}></Field>
    <Field label="Cert" for={`${uid}-cert`}><input class="input" type="file" id={`${uid}-cert`} accept=".pem,.crt,.cer" oninput={(e) => onInputFile(e, 'cert')} bind:this={certEl}></Field>
    <Field label="CA" for={`${uid}-ca`}>
      <div class="cert-ca-row"><input class="input" type="file" id={`${uid}-ca`} accept=".pem,.crt,.cer" oninput={(e) => onInputFile(e, 'ca')} bind:this={caEl}><Button size="sm" onclick={removeCa}>Remove CA</Button></div>
    </Field>
    {#if !hideMessage}<ul class="cert-notes"><li>If you do not upload a cert, a random key will be used.</li><li>If an incorrect cert is uploaded, it will work with HTTP.</li></ul>{/if}
    <Modal bind:open={alertOpen} title="Certificate">{alertMessage}{#snippet footer()}<Button variant="primary" onclick={() => (alertOpen = false)}>OK</Button>{/snippet}</Modal>
  </div>
  ```
  `uid = $props.id()`. 알림 문구는 옛 것 그대로: "Invalid private key", "Invalid certificate", "Invalid Key Pair".
- 스타일: `.cert-files { display: flex; flex-direction: column; gap: var(--s-3); padding-left: var(--s-3); border-left: 2px solid var(--line-2); }`, `.cert-ca-row { display: flex; gap: var(--s-2); align-items: center; }`, `.cert-notes { margin: 0; padding-left: var(--s-4); font-size: var(--fs-xs); color: var(--ink-2); }`. 고정 너비 없음.

### `admin/src/screens/ServerSettingsScreen.svelte` (신규)

- 상태: `serverOption = $state<ServerOption>(ServerOptionCtrl.instance.getCachedServerOption())`, `lastServerOption`, `adminCert = $state<CertInfo | null>(null)`, `lastAdminCert`, `originalAdminCert`, `snapshotRevision`, `loading = $state(false)`, 알림 모달 상태(`alertOpen`, `alertMessage`, `alertButton = 'OK'`, `alertClose`). `const session = useSession();`
- `isNewValue = $derived(...)` — 옛 `$:` 식 그대로.
- 이 화면은 `Shell` 없이 `mount(ServerSettingsScreen, {target})` 로 단독 마운트할 수 있어야 한다(`configuration.ts` fixture 가 그렇게 쓴다. 세션 컨텍스트가 없으면 `useSession()` 이 no-op 을 준다).
- 함수: `load`(옛 `onMount`), `updateAdminCert`, `alert(message, button = 'OK', onClose?)`, `apply`, `checkServerRestart`, `reset`, `sessionOut`(모달 "Session is expired. Please login again." → OK → `session.invalidate()`). "Unable to connect to the server." 는 옛 코드처럼 초기 로드에서는 OK → `location.href = '/'`, 저장·인증서 갱신에서는 "Retry" → 재시도. `checkServerRestart` 의 세 분기와 이동 주소 계산은 옛 코드 그대로(`<br/>` 는 공백으로). 다만 이동 주소는 R5(`admin/src` 에 `https?://` 문자열 금지) 때문에 `"https://"` 리터럴 대신 `` `${serverOption.adminTls ? 'https' : 'http'}://${location.hostname}:${serverOption.adminPort}/` `` 로 조립한다(옛 153~154·164~165행의 `"https://" : "http://"` 는 그대로 옮기면 R5 에 걸린다). `console.log` 두 줄은 옮기지 않는다.
- `clamp(value, min, max)`: `NumberInput` 의 `oninput` 에서 옛 `_enforceMinMax` 와 같이 값을 자른다(`null` 이면 그대로).
- 마크업(필드 순서·id):
  ```svelte
  <div class="server-settings">
    <Card>
      <Field label="Tunnel server-client authentication key" for="input-key"><TextInput id="input-key" bind:value={serverOption.key} /></Field>
      <Field label="Admin service port number" for="input-admin-port"><NumberInput id="input-admin-port" min={0} max={65535} bind:value={serverOption.adminPort} oninput={(v) => (serverOption.adminPort = clamp(v, 0, 65535))} /></Field>
      <Checkbox id="input-admin-tls" label="Admin TLS" bind:checked={serverOption.adminTls} />
      {#if serverOption.adminTls}<InputCertFile certInfo={adminCert} onupdate={updateAdminCert} />{/if}
      <Field label="Tunnel server port number" for="input-tunnel-port"><NumberInput id="input-tunnel-port" min={0} max={65535} bind:value={serverOption.port} oninput={(v) => (serverOption.port = clamp(v, 0, 65535))} /></Field>
      <Checkbox id="input-tunnel-tls" label="Tunnel TLS" bind:checked={serverOption.tls} />
      <Field label="Memory cache limit (MiB)" for="input-mem-cache-limit"><NumberInput id="input-mem-cache-limit" min={1} max={99999} bind:value={serverOption.globalMemCacheLimit} oninput={(v) => (serverOption.globalMemCacheLimit = clamp(v, 1, 99999))} /></Field>
      <Field label="Keep-Alive (ms)" for="input-keep-alive" hint="0 or less disables keep-alive."><NumberInput id="input-keep-alive" min={1} max={99999} bind:value={serverOption.keepAlive} oninput={(v) => (serverOption.keepAlive = clamp(v, 1, 99999))} /></Field>
    </Card>
    <div class="actions">
      <Button variant="primary" disabled={!isNewValue} onclick={apply}>Apply</Button>
      <Button onclick={reset}>Reset</Button>
    </div>
    {#if loading}<Loading overlay />{/if}
    <Modal bind:open={alertOpen} title="Server settings">{alertMessage}{#snippet footer()}<Button variant="primary" onclick={() => { alertOpen = false; alertClose(); }}>{alertButton}</Button>{/snippet}</Modal>
  </div>
  ```
  체크박스 문구는 옛 오기("Secure tunneling Server/Client")를 반복하지 않고 "Admin TLS" / "Tunnel TLS" 로 정한다. Keep-Alive 의 `min=1` 은 옛 코드 그대로다(안내문과 어긋나지만 D14 에 따라 유지하고 코멘트로 보고).
- 스타일: `.server-settings { display: flex; flex-direction: column; gap: var(--s-4); }`, `.card-body { display: flex; flex-direction: column; gap: var(--s-4); }` 는 `Card` 안 내용을 감싸는 `<div class="form-stack">` 으로 대신한다. `.actions { display: flex; gap: var(--s-3); justify-content: flex-end; }`.

### `test/admin/screen-server-settings.test.ts` (신규)

`startAdminApp()` 후 `page.evaluate(() => (location.hash = '#/server'))`. 케이스는 수용 기준. `finally`, `errors` 검사, 타임아웃 60_000.

## 변경할 것

- `admin/src/App.svelte`: `server` 분기를 `<ServerSettingsScreen />` 으로. `ServerSetLayout` import 삭제.
- `admin/src/layout/TunnelOptionSetLayout.svelte`: 11행 import 를 `../screens/parts/InputCertFile.svelte` 로, 532행을 `<InputCertFile certInfo={option.certInfo} onupdate={(value) => { option.certInfo = value; }} hideMessage={true} />` 로. 그 외 줄은 건드리지 않는다.
- `admin/test/configuration.ts`: `ServerSetLayout` import → `ServerSettingsScreen`; `mount(kind === 'server' ? ServerSettingsScreen : TunnelOptionSetLayout, …)`.
- `admin/test/CertificateFixture.svelte`: 룬 모드로 전환 — `let {auxiliary = false} = $props()`, `certificate = $state(initial)`, `redraws = $state(0)`, `updates = $state(0)`, `gaugeValue/timerSeconds/timerTotal = $state(...)`. import 경로 `../src/screens/parts/InputCertFile.svelte`. `<button onclick={() => redraws++}>Parent redraw</button><InputCertFile certInfo={certificate} hideMessage={true} onupdate={(value) => { certificate = value; updates++; }} /><output id="updates">{updates}</output><output id="redraws">{redraws}</output><pre id="certificate">{JSON.stringify(certificate)}</pre>`. `width` 관련 코드 삭제. `window.certificateFixture.replace/mutate/updateAuxiliary` 계약 유지(`mutate` 는 `certificate!.key = value.key; …` 로 깊은 필드 대입).
- `test/admin/certificate-lifecycle.test.ts` 33행: `{name: "Ok", exact: true}` → `{name: "OK", exact: true}`.
- `test/admin/configuration-certificate-conflict.discovery.test.ts` 31행: 같은 변경.
- `test/admin/crypto-replacement.test.ts` 12행: 경로를 `admin/src/screens/parts/InputCertFile.svelte` 로.
- 삭제: `admin/src/layout/ServerSetLayout.svelte`, `admin/src/layout/InputCertFile.svelte`.

## 하지 말 것

- `ServerOptionCtrl.ts`, `CertificationCtrl.ts`, `ObjectUtil.ts` 수정 금지. 백엔드 수정 금지.
- 인증서 검증 로직(`node-forge` 호출, 2048비트 검사, PEM 헤더 검사)을 "개선" 하지 않는다. `randomHex(64)` 호출을 유지한다(`crypto-replacement.test.ts` 가 문자열로 검사한다).
- `InputCertFile` 이 prop `certInfo` 를 대입·변이하지 않는다.
- `checkServerRestart` 의 `location.href` 이동을 제거하지 않는다(새 admin 주소로의 이동은 실제 origin 변경이다).
- 기존 테스트 케이스를 삭제하거나 `skip` 하지 않는다. 선택자·문구만 위 목록대로 바꾼다.
- `TunnelOptionSetLayout.svelte` 의 다른 부분 수정 금지(U1-09).
- `export let`, `createEventDispatcher`, `on:` 디렉티브, `{@html}` 금지.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/admin/screen-server-settings.test.ts` (`startAdminApp()` → `#/server`)
  - `h1` 이 "Server settings" 이고, `#input-key` 의 값이 비어 있지 않을 때까지 기다리면 "Apply" 버튼이 disabled 이다.
  - `#input-key` 를 "changed-key" 로 바꾸면 "Apply" 가 enabled 이다. "Reset" 클릭 → `#input-key` 가 원래 값으로 돌아오고 "Apply" 가 다시 disabled 이다.
  - `#input-admin-port` 에 "70000" 입력 → 값이 "65535" 이다. "0" 입력 → "0".
  - `#input-admin-tls` 를 `check()` → `input[type="file"]` 이 3개 보인다. "Remove CA" 버튼이 있다. `uncheck()` → 0개.
  - `#input-tunnel-tls`, `#input-mem-cache-limit`, `#input-keep-alive` 가 존재하고 `getByLabel("Memory cache limit (MiB)")` 로 찾을 수 있다.
  - `errors` 가 빈 배열이다.
- `test/admin/certificate-lifecycle.test.ts` 5개 케이스가 새 부품·새 fixture 로 통과한다("Parent redraw" 뒤에도 편집 중 키 파일 유지, `replace(empty())` 로 초점 유지, `mutate` 로 파일 갱신, `null` 로 비움).
- `test/admin/configuration-editor.test.ts` 첫 케이스("server editor submits its held revision …")가 새 화면으로 통과한다: Apply 후 모달에 "Configuration changed" 문구, `#input-admin-port` 값 유지, 요청 1건.
- `test/admin/compound-stale-rename.test.ts`, `configuration-certificate-conflict.discovery.test.ts`, `server-buffer-minimum.test.ts`, `configuration-editor.test.ts` 의 터널 케이스가 옛 `TunnelOptionSetLayout` + 새 `InputCertFile` 조합으로 통과한다.
- `test/admin/crypto-replacement.test.ts` 가 새 경로로 통과한다.

기존 `test/admin/*.test.ts` 전부 통과.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npm --prefix admin run check
npm run test:admin
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U1-05(`startAdminApp`). U1-06 과 독립.
- 후행: U1-09(TunnelEditScreen 이 새 `InputCertFile` 을 쓴다), U1-10.

## 근거 문서

- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §7.5(ServerSettingsScreen·InputCertFile), §8.3(`screen-server-settings.test.ts`), §9(U1-07: 기존 `certificate-lifecycle`·`configuration-editor` 통과)
- `docs/design/2026-09-11-program-overview.md` §1 D2·D3·D5·D14, §3.3 테스트 규약(테스트 삭제 금지)

---
## U1-08

**title**: feat(admin): TunnelsScreen 카드 목록·활성 스위치·타이머 이식
**labels**: enhancement, area:frontend, unit:1
**body**:
## 목적

터널 화면의 목록·상태 부분을 `screens/TunnelsScreen.svelte` 로 만들어 `#/tunnels` 에 장착한다(D7: 카드 목록 + 카드 탭 시 전체 화면 편집). 이 이슈가 끝나면 터널마다 카드 하나에 포트·목적지·프로토콜·상태 배지·가동 통계·활성 스위치·타임아웃 타이머가 보이고, 카드를 누르면 `#/tunnels/<port>` 로 이동한다. 편집 화면(`#/tunnels/<port>`, `#/tunnels/new`)은 아직 옛 `TunnelOptionSetLayout` 이 맡는다(U1-09).

## 배경

- 옛 화면 `admin/src/layout/TunnelOptionSetLayout.svelte`(739줄)에서 **이 이슈가 옮기는** 함수:
  - `onMount`(43~51행) 중 `_loadTunnelingOption()`(96~124행)의 목록 로드 부분: `getTunnelingOption()` → `_tunnelOptions`(`snapshot.value`)·`_snapshotRevision`. 인증서 로드(`_loadCertInfoAll`)와 `updatable` 계산은 편집 화면 몫이라 옮기지 않는다. 예외 처리: `InvalidSession` → `_sessionOut()`, 그 외 `_connectionFail()`.
  - `_startExternalServerStatusUpdate`(158~168행): 즉시 1회 `_loadExternalServerStatus()`, 이후 `setInterval` 1000ms; 콜백에서 `_loading` 이면 건너뛰고, `_loadExternalServerStatus(true)` 가 false 면 `clearInterval`.
  - `_loadExternalServerStatus(ignoreError?)`(170~197행): `loadTunnelingStatus()` → `_serverTime`, `_externalServerStatuses[port] = status`. 예외: `ignoreError` 면 false; `InvalidSession` 이면 `_sessionOut()`; 그 외 `_connectionFail()`. 타이머 요소에 `update(...)` 를 밀어 넣던 176~181행은 새 `Timer` 가 prop 으로 받으므로 사라진다.
  - `_connectionFail`(316~320행): "Unable to connect to the server." → OK → `location.href = "/"`. 새 화면: 모달 → "Retry" → `load()` 재실행(설계 §7.4).
  - `_sessionOut`(322~326행): 모달 → OK → `session.invalidate()`.
  - `_alert`(329~342행).
  - `_startupTime`(353~368행: `Date.now() - uptime` 을 `{d}d, {h}h` / `{h}h, {m}m` / `{m}m` / `{s}s` 로), `_floorPoint`(370~373행), `_toSize`(375~387행: Gb/Mb/Kb/B, 소수 2자리 내림), `_getTimeout(status)`(389~397행: `activeStart + activeTimeout*1000 - _serverTime` 을 초로, 음수면 0).
  - `_onChangeActive(active, port, time?)`(399~443행): `oldActive == active && time == undefined` 면 아무 것도 안 함; `time = time ?? status.activeTimeout`; `_loading = true` → `activeExternalPortServer(active, port, time)` → `_loadExternalServerStatus()` → 성공이면 `status.active = active`, 실패면 되돌림. 예외는 세션/접속 실패 처리. 옛 코드의 `_timerElements[...].update(...)` 호출(404~406행)과 빈 `if(time > 0) {}`(426~428행)은 옮기지 않는다.
  - 마크업(459~518행, 647행): 터널마다 제목 `{forwardPort} ⬌ {destinationAddress}:{destinationPort} ({PROTOCOL})`, 상태 `Online`(darkgreen)/`Error`(darkred)/`Offline`(gray), `Uptime: …, Sessions: …, RX: …, TX: …`, online 이면 "Activation:" + `<Switch on={status.active} on:change>`, active 이면 "Timeout:" + `<Timer>`; 목록 끝 버튼 "Add tunneling service"(`_addEmptyOption`).
- `ServerOptionCtrl`(`admin/src/controller/ServerOptionCtrl.ts`): `getTunnelingOption()` → `{value: Options[], revision}`(58~69행), `loadTunnelingStatus()` → `{serverTime, statuses: TunnelingStatus[]}`(172~182행), `activeExternalPortServer(active, port, timeout?)` → `POST /api/tunneling/active/:port` `{active, timeout}`(184~195행). 변경 없음. 타입 `Options`, `TunnelingStatus`(`controller/Options.ts`).
- 스텁 백엔드(U1-05): `with-tunnels` fixture 에 20001(tcp)·20002(http) 두 터널. `externalServerStatuses()` 가 `{online: true, active: true, activeTimeout: 3600, activeStart: startedAt, uptime: startedAt, sessions: 0, rx: 0, tx: 0}` 를 주고, `activeExternalPortServer(port, timeout)`·`inactiveExternalPortServer(port)` 호출이 `calls()` 에 기록되며 이후 `active` 상태가 바뀐다. `/api/tunneling/active/:port` 는 `active === true` 면 `activeExternalPortServer(port, timeout)`, 아니면 `inactiveExternalPortServer(port)` 를 부른다(`AdminServer.ts` 889~893행).
- 부품: `Button`, `Card`, `Chip`, `Badge`, `Switch`(U1-02), `Timer`, `Modal`, `Loading`(U1-03). `router.ts` 의 `navigate`, `shell/session.ts`(U1-04). `screens/parts/units.ts`(U1-06).

먼저 열어 볼 파일: `admin/src/layout/TunnelOptionSetLayout.svelte`(위 행), `admin/src/controller/ServerOptionCtrl.ts`, `admin/src/controller/Options.ts`, `admin/src/ui/Timer.svelte`, `admin/src/ui/Switch.svelte`, `admin/src/screens/parts/units.ts`, `admin/src/App.svelte`, `test/admin/admin-backend-driver.ts`.

## 적용되는 결정

- D7 터널 화면은 카드 목록 + 카드 탭 시 전체 화면 편집.
- D3 모바일 우선. D5 영어 문구.
- D14 동작 변경 없음(폴링·활성 전환·타임아웃 변경 요청은 옛 코드와 같은 API 호출).

## 만들 것

### `admin/src/screens/parts/units.ts` (추가)

```ts
export const startupTime = (uptime: number): string => …;   // 옛 _startupTime 그대로
export const toSize = (bytes: number): string => …;         // 옛 _toSize + _floorPoint 그대로
```

### `admin/src/screens/TunnelsScreen.svelte` (신규)

- 상태: `options = $state<Options[]>([])`, `statuses = $state<Record<number, TunnelingStatus>>({})`, `serverTime = $state(0)`, `loading = $state(false)`, `intervalId`, 알림 모달 상태(`alertOpen`, `alertMessage`, `alertButton`, `alertClose`). `const session = useSession();`
- `load()`: `getTunnelingOption()` → `options = snapshot.value`; 이어서 `loadStatus()`; 예외는 옛 `_loadTunnelingOption` 과 같이 처리.
- 이 화면은 `Shell` 없이 단독 마운트할 수 있어야 한다(세션 컨텍스트가 없으면 `useSession()` 이 no-op).
- `loadStatus(ignoreError?)`, `startStatusUpdate()`, `getTimeout(status)`, `onChangeActive(active, port, time?)`: 옛 함수 그대로(위 목록). `onMount(() => { load().then(startStatusUpdate); return () => clearInterval(intervalId); })`.
- `connectionFail()`: `alert('Unable to connect to the server.', 'Retry', () => load())`. `sessionOut()`: `alert('Session is expired. Please login again.', 'OK', () => session.invalidate())`.
- 마크업:
  ```svelte
  <div class="tunnels">
    <div class="tunnels-bar"><Button variant="primary" onclick={() => navigate('#/tunnels/new')}>Add tunneling service</Button></div>
    {#if options.length === 0}<p class="empty">No tunnels yet.</p>{/if}
    <ul class="tunnel-list">
      {#each options as option (option.forwardPort)}
        {@const status = statuses[option.forwardPort]}
        <li data-port={option.forwardPort}>
          <Card>
            <a class="tunnel-link" href={`#/tunnels/${option.forwardPort}`}>
              <div class="tunnel-row tunnel-head">
                <span class="mono tunnel-port">{option.forwardPort}</span><span class="tunnel-arrow" aria-hidden="true">⬌</span>
                <span class="tunnel-dest">{option.destinationAddress}:{option.destinationPort}</span>
                <Chip>{(option.protocol ?? '').toUpperCase()}</Chip>
              </div>
              <div class="tunnel-row">
                {#if status && status.online}
                  <Badge tone="pulse">Online</Badge>
                  <span class="mono tunnel-stats">Uptime {startupTime(status.uptime)} · Sessions {status.sessions} · RX {toSize(status.rx)} · TX {toSize(status.tx)}</span>
                {:else if status}
                  <Badge tone="alarm">Error</Badge>
                {:else}
                  <Badge tone="neutral">Offline</Badge>
                {/if}
              </div>
            </a>
            {#if status?.online}
              <div class="tunnel-row tunnel-controls">
                <span class="tunnel-label">Activation</span>
                <Switch on={status.active} ariaLabel={`Activation ${option.forwardPort}`} onchange={(on) => onChangeActive(on, option.forwardPort)} />
                {#if status.active}
                  <span class="tunnel-label">Timeout</span>
                  <Timer seconds={getTimeout(status)} total={status.activeTimeout} onchange={(s) => onChangeActive(true, option.forwardPort, s)} />
                {/if}
              </div>
            {/if}
          </Card>
        </li>
      {/each}
    </ul>
    {#if loading}<Loading overlay />{/if}
    <Modal bind:open={alertOpen} title="Tunnels">{alertMessage}{#snippet footer()}<Button variant="primary" onclick={() => { alertOpen = false; alertClose(); }}>{alertButton}</Button>{/snippet}</Modal>
  </div>
  ```
  카드 1·2행은 `<a href>` 라 해시 이동이 브라우저 기본 동작이고, 3행(스위치·타이머)은 링크 밖에 있어 전파를 막을 필요가 없다.
- 스타일: `.tunnels-bar { margin-bottom: var(--s-4); }`, `.tunnel-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-3); }`, `.tunnel-link { display: block; color: inherit; text-decoration: none; }`, `.tunnel-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); }`, `.tunnel-head { margin-bottom: var(--s-2); }`, `.tunnel-port { font-size: var(--fs-lg); font-weight: 500; }`, `.tunnel-dest { color: var(--ink-1); word-break: break-all; }`, `.tunnel-stats { font-size: var(--fs-xs); color: var(--ink-2); }`, `.tunnel-controls { margin-top: var(--s-3); padding-top: var(--s-3); border-top: 1px solid var(--line-0); gap: var(--s-3); }`, `.tunnel-label { font-size: var(--fs-sm); color: var(--ink-2); }`, `.empty { color: var(--ink-2); }`.

### `test/admin/screen-tunnels.test.ts` (신규, 목록 부분)

`startAdminApp({fixture: 'with-tunnels'})` 후 `location.hash = '#/tunnels'`. 케이스는 수용 기준. `finally`, `errors` 검사, 타임아웃 60_000. U1-09 가 편집·추가·삭제 케이스를 같은 파일에 덧붙인다.

## 변경할 것

- `admin/src/App.svelte`: `tunnels` 분기를 `<TunnelsScreen />` 으로, `tunnel-edit` 분기는 `<TunnelOptionSetLayout />` 유지(U1-09 가 교체).
- `admin/src/screens/parts/units.ts`: 함수 2개 추가.
- 그 외 변경 없음. `layout/TunnelOptionSetLayout.svelte` 는 손대지 않는다.

## 하지 말 것

- 편집 폼·저장·삭제·인증서 로드를 이 화면에 넣지 않는다(U1-09).
- 상태 폴링 주기·건너뛰기 규칙을 바꾸지 않는다.
- `Switch` 를 `bind:on` 으로 묶지 않는다(값은 서버 상태가 원천이며 폴링이 되돌린다).
- `Timer` 에 명령형 호출을 하지 않는다(prop 만).
- 카드 클릭 처리를 JS 로 만들지 않는다(`<a href>` 로 충분하다).
- `export let`, `createEventDispatcher`, `on:` 디렉티브, `{@html}` 금지.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/admin/screen-tunnels.test.ts` (`with-tunnels`, `#/tunnels`)
  - `h1` 이 "Tunnels". `li[data-port="20001"]` 과 `li[data-port="20002"]` 가 보이고 `li[data-port]` 는 정확히 2개다.
  - 20001 카드의 `.tunnel-head` 텍스트에 "20001", "127.0.0.1:9" 가 있고 `.chip` 이 "TCP" 이다. 20002 카드의 `.chip` 은 "HTTP".
  - 두 카드 모두 `.badge` 텍스트가 "Online" 이고 `.tunnel-stats` 가 `/^Uptime \d+[dhms]/` 에 맞는다.
  - 20001 카드의 `getByRole("switch", {name: "Activation 20001"})` 이 `aria-checked="true"` 이고 "Timeout" 라벨과 `.timer-text` 가 보이며 그 텍스트가 `/^59m \d+s$/` 에 맞는다(남은 초 = `activeStart + 3600·1000 − serverTime` 이라 항상 3600 미만이고, 옛 `_getTimeString` 은 시가 0 이면 `{m}m {s}s` 만 찍는다).
  - 그 스위치를 클릭 → 2초 안에 `aria-checked="false"` 가 되고 20001 카드의 "Timeout" 라벨이 사라진다. `calls()` 에 `{method: 'inactiveExternalPortServer', args: [20001]}` 가 정확히 1건 있다.
  - 20002 카드의 `.timer-text` 클릭 → `getByRole("dialog", {name: "Tunneling activity restriction time"})` → Days 0, Hours 0, Minutes 10 → "OK" → `calls()` 에 `{method: 'activeExternalPortServer', args: [20002, 600]}` 가 있고 2초 안에 그 카드의 `.timer-text` 가 `/^(10m 0s|9m \d+s)$/` 에 맞는다(스텁이 `activeStart` 를 변경 시각으로 갱신하므로 남은 초가 600 에서 줄어든다).
  - 20001 카드의 `a.tunnel-link` 클릭 → `location.hash === '#/tunnels/20001'`, `h1` 이 "Tunnel 20001".
  - "Add tunneling service" 클릭 → `location.hash === '#/tunnels/new'`, `h1` 이 "New tunnel".
  - (`password` fixture) `#/tunnels` 에서 "No tunnels yet." 이 보이고 `li[data-port]` 가 0개다.
  - `#/tunnels` 에서 `page.on('request')` 로 `/api/externalServerStatuses` 요청이 2초 동안 2건 이상 늘고, `#/status` 로 이동한 뒤 1.5초 동안 0건 늘어난다.
  - `errors` 가 빈 배열이다.

기존 `test/admin/*.test.ts` 전부 통과(`configuration.ts` fixture 는 옛 `TunnelOptionSetLayout` 을 계속 마운트한다).

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npm --prefix admin run check
npm run test:admin
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U1-06(`units.ts`), U1-05(`with-tunnels` fixture). U1-07 과 독립.
- 후행: U1-09(편집 화면이 카드 링크의 목적지를 채운다).

## 근거 문서

- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §7.3(TunnelsScreen), §8.2(fixture `with-tunnels`), §8.3(`screen-tunnels.test.ts` 목록 부분), §9(U1-08)
- `docs/design/2026-09-11-program-overview.md` §1 D3·D5·D7·D14

---
## U1-09

**title**: feat(admin): TunnelEditScreen 과 HTTP 옵션 부품 이식, 옛 터널 레이아웃 제거
**labels**: enhancement, area:frontend, unit:1
**body**:
## 목적

터널 편집 폼을 `screens/TunnelEditScreen.svelte` 로, HTTP 헤더·본문 치환 편집기를 `screens/parts/HeaderAppender.svelte`·`BodyReplaceAppender.svelte` 로 다시 만들어 `#/tunnels/new` 와 `#/tunnels/<port>` 에 장착한다. 옛 `layout/TunnelOptionSetLayout.svelte`·`HeaderAppender.svelte`·`BodyReplaceAppender.svelte` 를 지운다. 이 이슈가 끝나면 `layout/` 디렉터리는 비고, 터널 편집 관련 기존 브라우저 테스트 4개 파일이 새 화면으로 통과한다.

## 배경

- 옛 화면 `admin/src/layout/TunnelOptionSetLayout.svelte`(739줄)에서 **이 이슈가 옮기는** 함수(U1-08 이 옮긴 목록·폴링·활성 전환은 제외):
  - `$:` 블록(54~63행): `_isInit && length > 0` 이면 `_checkUpdatable()`; 모든 옵션의 `destinationPort`·`forwardPort` 를 `_normalizePortNumber`(65~73행: 0~65535 로 자름), `bufferLimitOnClient` 를 `_normalizeMemBufferSize`(75~83행: -1~1048576)로 자름.
  - `_validServerBuffer`(86행): `typeof value === 'number' && Number.isFinite(value) && value >= 1 && Number.isFinite(value * 1024 * 1024)`.
  - `_checkUpdatable`(88~93행): `updatable = ServerOptionCtrl.checkValidTunnelingOption(option) && _validServerBuffer(option.bufferLimitOnServer)`.
  - `_loadTunnelingOption`(96~124행): `getTunnelingOption()` → 각 옵션에 `isSync = true`, `originalForwardPort = forwardPort`, `updatable = true`, `allowedClientNamesQuery = allowedClientNames.join("; ") + ";"`(없으면 `""`); `_loadCertInfoAll()`; `_checkUpdatable()`. 예외: `InvalidSession` → `_sessionOut()`, 그 외 `_connectionFail()`.
  - `_loadCertInfo(port)`(134~156행): `loadExternalServerCert(port)` → `certInfo`, `certificateRevision`; `originalCertificateRevision` 이 없고 `originalForwardPort === port` 면 `originalCertificateRevision = revision`.
  - `_addEmptyOption`(200~228행): `{forwardPort: Math.floor(Math.random() * 65534 + 10), tls: false, protocol: 'tcp', httpOption: {rewriteHostInTextBody: true, replaceAccessControlAllowOrigin: false, customRequestHeaders: [], customResponseHeaders: [], bodyRewriteRules: []}, destinationAddress: '127.0.0.1', destinationPort: 8080, isSync: false, updatable: true, inactiveOnStartup: false, bufferLimitOnClient: 10, bufferLimitOnServer: 10, allowedClientNamesQuery: ""}`.
  - `_onChangeProtocol(option)`(233~242행): `https` 면 `tls = true`(이전에 false 였으면 `_onChangeSecureTunneling`), 아니면 `tls = false`.
  - `_onClickRemove(index)`(245~277행): `isSync` 면 `removeTunnelingOption(option, _snapshotRevision)`; 성공 시 목록에서 제거, `isSync` 였으면 "Tunneling option has been removed.<br/>The external server has been shut down." 알림, `_loadTunnelingOption()`; 실패 시 "Fail: " + message.
  - `_onClickApply(index)`(279~313행): `allowedClientNames = allowedClientNamesQuery.split(";").map(trim).filter(비어있지 않음)`; `updateTunnelingOption(option, _snapshotRevision, {certInfo: tls ? certInfo : undefined, expectedCertificateRevision: originalForwardPort !== undefined && originalForwardPort !== forwardPort ? originalCertificateRevision : certificateRevision, previousForwardPort: originalForwardPort})`; 성공 → "Success to apply tunneling option" 후 `_loadTunnelingOption()`·`_loadExternalServerStatus()`; 실패 → "Fail to apply tunneling option: " + message 후 return. 예외는 세션/접속 실패.
  - `_onChangeSecureTunneling(forwardPort)`(344~351행): 옵션이 있으면 `_loadCertInfo(forwardPort)`.
  - 마크업(520~639행) 필드 순서와 id: `#input-external-port`(number, `bind:value={option.forwardPort}`), TLS 체크박스 `#sdf`(`on:change={() => _onChangeSecureTunneling(option.forwardPort)}`, `disabled={protocol !== "tcp"}`, 문구 "Secure tunneling Server/Client"), `{#if tls === true}<InputCertFile hideMessage={true}>`, `#input-destination-host`, `#input-destination-port`, `#input-allow-client-names`("Allowed Client names (Separate names with a semicolon(;))"), `#input-active-timeout`("Keep-Alive Timeout (ms)", `bind:value={option.keepAlive}`), "Mem Buffer size limit per Sessions (MiB)" 절: `#input-buffer-limit-server`(`min="1" step="any"`, 검증 실패 시 `<small role="alert">Server buffer must be a finite number of at least 1 MiB.</small>`), `#input-buffer-limit-client`, 안내 3줄("Server buffer: finite values of at least 1 MiB; fractions are allowed.", "Client buffer: nonpositive values retain the existing unlimited setting.", "Positive limits spill excess buffered data to the file cache."), `#select-protocol`(tcp/"TCP", http/"HTTP (http/1.1)", https/"HTTPS (http/1.1)", `on:change={() => _onChangeProtocol(option)}`), http·https 일 때 "HTTP Options" 절: `#select-change-host-in-body`(Enabled/Disabled), `#select-change-acao`(Enabled/Disabled) — **두 select 는 옛 코드에서 어떤 값에도 바인딩되지 않아 저장에 반영되지 않는 결함이 있다**. 새 화면은 각각 `httpOption.rewriteHostInTextBody`·`httpOption.replaceAccessControlAllowOrigin` 에 바인딩한다(설계 §7.4 의 의도). 이 차이를 코멘트로 보고한다 —, "Inject request header" `HeaderAppender bind:options={httpOption.customRequestHeaders}`, "Inject response header" `HeaderAppender bind:options={httpOption.customResponseHeaders}`, "Replace text in body" `BodyReplaceAppender bind:options={httpOption.bodyRewriteRules}`; 체크박스 "Inactive on startup"(`bind:checked={option.inactiveOnStartup}`); 버튼 `{isSync ? ' Apply and Restart ' : 'Start'}`(`disabled={!updatable}`), `{isSync ? 'Stop and ' : ''}Remove`.
- 옛 부품 `admin/src/layout/HeaderAppender.svelte`(81줄): `export let options: Array<{name, value, replace?}>`, `$:` 로 빈 배열이면 빈 항목 1개 삽입(14~22행), `onClickAdd`(25~31행), `onClickRemove(index)`(33~35행). 행마다 name/value 입력, 마지막 행은 "+", 나머지는 "-", "Replace header" 체크박스. `generatePastelColor`·`maxWidth` 는 옮기지 않는다.
- 옛 부품 `admin/src/layout/BodyReplaceAppender.svelte`(85줄): 같은 구조로 `{from, to}`, 버튼 "Add"/"Remove", 안내문 "You can use a JavaScript-formatted regular expression in the 'From' input box."
- 옛 화면을 마운트하는 fixture `admin/test/configuration.ts` 의 `mount(kind)` 와, 그것을 쓰는 테스트: `test/admin/configuration-editor.test.ts` 두 번째 케이스(`mount("tunnel")` 62행; `#input-external-port` 입력, "Apply and Restart" 클릭, `getByText(stale ? /Fail/ : /Success to apply/).first()`, 요청이 `["POST /api/tunnelingOption"]` 1건, 입력값 유지), `test/admin/compound-stale-rename.test.ts`(`mount("tunnel")` 24행, `#input-external-port`, `#sdf` uncheck 33행 → `/api/externalCert/<port>` 응답 대기, "Apply and Restart"), `test/admin/configuration-certificate-conflict.discovery.test.ts`(`mount("tunnel")` 25행, `input[type="file"]`, "Invalid Key Pair", "OK", "Apply and Restart", `getByText(/Configuration changed/).first()`), `test/admin/server-buffer-minimum.test.ts`(`mount('tunnel')` 17행, `#input-buffer-limit-server`, "Apply and Restart" 버튼 `isDisabled`, 오류 문구 exact, `#input-buffer-limit-client` 값 "-1", 성공 문구 'Success to apply tunneling option' exact, 안내문 exact). 이 네 테스트는 서버에 터널을 하나만 넣고 마운트하므로 `mount('tunnel', String(port))` 로 포트를 넘기도록 바꾼다.
- 컨트롤러 `ServerOptionCtrl.updateTunnelingOption`(146~158행)은 `certInfo`, `certificateRevision`, `originalCertificateRevision`, `originalForwardPort`, `previousForwardPort`, `expectedCertificateRevision`, `isSync`, `updatable`, `allowedClientNamesQuery`, `activeTimeout` 필드를 본문에서 제거한 뒤 `compound` 를 합쳐 보낸다. `removeTunnelingOption`(160~169행), `checkValidTunnelingOption`(199~230행). 변경 없음.
- 스텁 백엔드(U1-05): `applyTunnelingOption`·`stopExternalPortServer`·`externalServerStatus` 가 `calls()` 에 기록된다. 새 터널 저장은 `UsablePortChecker.check(forwardPort)` 를 거치므로 테스트 포트 20003 은 비어 있어야 한다.
- 부품: `Card`, `Field`, `TextInput`, `NumberInput`, `Select`, `Checkbox`, `Button`(U1-02), `Modal`, `Toast`·`toast`, `Loading`(U1-03), `InputCertFile`(U1-07), `TunnelsScreen`(U1-08).

먼저 열어 볼 파일: `admin/src/layout/TunnelOptionSetLayout.svelte`, `admin/src/layout/HeaderAppender.svelte`, `admin/src/layout/BodyReplaceAppender.svelte`, `admin/test/configuration.ts`, 위 테스트 4개, `test/admin/screen-tunnels.test.ts`, `admin/src/controller/ServerOptionCtrl.ts`, `admin/src/screens/parts/InputCertFile.svelte`.

## 적용되는 결정

- D7 카드 탭 시 전체 화면 편집, 하단 고정 바.
- D3·D5.
- D14 동작 변경 없음. 허용된 예외: 새 터널 편집 화면에서 삭제 버튼 숨김. 추가 보고 대상: HTTP 옵션 select 2개 바인딩.

## 만들 것

### `admin/src/screens/parts/HeaderAppender.svelte` (신규)

- props: `options = $bindable<CustomHeader[]>([])`.
- `$effect(() => { if (options.length === 0) options = [{name: '', value: '', replace: false}]; })`, `add()`, `remove(index)` — 옛 로직 그대로.
- 마크업: 행마다 `<div class="rule"><TextInput placeholder="Name" bind:value={option.name} /><span class="colon">:</span><TextInput placeholder="Value" bind:value={option.value} />{#if index === options.length - 1}<Button size="sm" onclick={add}>+</Button>{:else}<Button size="sm" onclick={() => remove(index)}>-</Button>{/if}<Checkbox id={`${uid}-replace-${index}`} label="Replace header" bind:checked={option.replace} /></div>`. `uid = $props.id()`.
- 스타일: `.rule { display: grid; grid-template-columns: 1fr auto 1fr auto; gap: var(--s-2); align-items: center; padding: var(--s-3); border: 1px solid var(--line-1); border-radius: var(--r-2); background: var(--bg-3); margin-bottom: var(--s-2); }`, `.rule .check { grid-column: 1 / -1; }`.

### `admin/src/screens/parts/BodyReplaceAppender.svelte` (신규)

- props: `options = $bindable<RewriteRule[]>([])`. 같은 구조. 행: `<Field label="From"><TextInput bind:value={option.from} /></Field><Field label="To"><TextInput bind:value={option.to} /></Field>` + 마지막 행 `Button "Add"`, 나머지 `Button "Remove"`. 목록 아래 `<p class="hint">You can use a JavaScript-formatted regular expression in the 'From' input box.</p>`.

### `admin/src/screens/TunnelEditScreen.svelte` (신규)

- props: `param: string` (`'new'` 또는 포트 문자열). `App` 은 `$route.param` 을 넘기고, `configuration.ts` fixture 는 포트 문자열을 직접 주입한다. 이 화면은 `Shell` 없이 단독 마운트할 수 있어야 한다(세션 컨텍스트가 없으면 `useSession()` 이 no-op). 저장 시 `allowedClientNamesQuery` 는 옛 코드 그대로 세미콜론(`;`)으로 나눈다(쉼표 아님).
- 타입 `TunnelingOptionEx` 는 옛 21행 정의 그대로 이 파일에 둔다.
- 상태: `option = $state<TunnelingOptionEx | undefined>()`, `snapshotRevision`, `loading = $state(false)`, `confirmOpen = $state(false)`, 알림 모달 상태. `const session = useSession();`
- `load()`: `getTunnelingOption()` → `snapshotRevision`; `param === 'new'` 면 `option = emptyOption()`(옛 `_addEmptyOption` 값); 아니면 `snapshot.value.find(o => o.forwardPort === Number(param))` 에 옛 `_loadTunnelingOption` 의 필드 보강(`isSync`, `originalForwardPort`, `updatable`, `allowedClientNamesQuery`) 후 `loadCertInfo(forwardPort)`; 없으면 `navigate('#/tunnels')`. 예외 처리는 옛 코드와 같다(`connectionFail` 은 "Retry" → `load()`).
- `updatable = $derived(option ? ServerOptionCtrl.checkValidTunnelingOption(option) && validServerBuffer(option.bufferLimitOnServer) : false)`.
- `clampPort(v)`, `clampClientBuffer(v)`: 옛 `$:` 정규화를 해당 `NumberInput` 의 `oninput` 에서 수행.
- `onChangeProtocol()`, `onChangeSecureTunneling()`, `loadCertInfo()`, `apply()`, `remove()`: 옛 함수 그대로. 결과 알림만 바뀐다:
  - `apply` 성공: `toast.push({tone: 'pulse', message: 'Success to apply tunneling option'})` 후 `navigate('#/tunnels')`. 실패: `toast.push({tone: 'alarm', message: 'Fail to apply tunneling option: ' + result.message})`.
  - `remove` 성공: `toast.push({tone: 'pulse', message: 'Tunneling option has been removed. The external server has been shut down.'})` 후 `navigate('#/tunnels')`. 실패: `toast.push({tone: 'alarm', message: 'Fail: ' + result.message})`.
  - 세션 만료·접속 실패는 `Modal`(OK → `session.invalidate()` / Retry → 재시도).
- 마크업(필드 순서·id 고정):
  ```svelte
  {#if option}
  <form class="tunnel-edit" onsubmit={(e) => e.preventDefault()}>
    <Card>
      <div class="form-stack">
        <Field label="External server port" for="input-external-port"><NumberInput id="input-external-port" min={1} max={65535} bind:value={option.forwardPort} oninput={(v) => (option.forwardPort = clampPort(v))} /></Field>
        <Checkbox id="input-tls" label="Secure tunneling Server/Client" bind:checked={option.tls} disabled={option.protocol !== 'tcp'} onchange={() => onChangeSecureTunneling(option.forwardPort)} />
        {#if option.tls === true}<InputCertFile certInfo={option.certInfo} hideMessage={true} onupdate={(value) => (option.certInfo = value)} />{/if}
        <Field label="Destination host" for="input-destination-host"><TextInput id="input-destination-host" bind:value={option.destinationAddress} /></Field>
        <Field label="Destination port" for="input-destination-port"><NumberInput id="input-destination-port" min={1} max={65535} bind:value={option.destinationPort} oninput={(v) => (option.destinationPort = clampPort(v))} /></Field>
        <Field label="Allowed client names (Separate names with semicolon(;))" for="input-allow-client-names"><TextInput id="input-allow-client-names" bind:value={option.allowedClientNamesQuery} /></Field>
        <Field label="Keep-Alive timeout (ms)" for="input-active-timeout"><NumberInput id="input-active-timeout" bind:value={option.keepAlive} /></Field>
      </div>
    </Card>
    <Card label="Buffer limit per session (MiB)">
      <div class="two-col">
        <Field label="Server" for="input-buffer-limit-server" error={validServerBuffer(option.bufferLimitOnServer) ? undefined : 'Server buffer must be a finite number of at least 1 MiB.'}><NumberInput id="input-buffer-limit-server" min={1} step="any" invalid={!validServerBuffer(option.bufferLimitOnServer)} bind:value={option.bufferLimitOnServer} /></Field>
        <Field label="Client" for="input-buffer-limit-client"><NumberInput id="input-buffer-limit-client" bind:value={option.bufferLimitOnClient} oninput={(v) => (option.bufferLimitOnClient = clampClientBuffer(v))} /></Field>
      </div>
      <ul class="notes"><li>Server buffer: finite values of at least 1 MiB; fractions are allowed.</li><li>Client buffer: nonpositive values retain the existing unlimited setting.</li><li>Positive limits spill excess buffered data to the file cache.</li></ul>
    </Card>
    <Card>
      <div class="form-stack">
        <Field label="Protocol" for="select-protocol"><Select id="select-protocol" options={PROTOCOLS} bind:value={option.protocol} onchange={onChangeProtocol} /></Field>
        {#if option.protocol === 'http' || option.protocol === 'https'}
          <h2 class="section-title">HTTP options</h2>
          <Field label="Replace host (address) in text body" for="select-change-host-in-body"><Select id="select-change-host-in-body" options={ENABLED} value={String(option.httpOption.rewriteHostInTextBody ?? true)} onchange={(v) => (option.httpOption.rewriteHostInTextBody = v === 'true')} /></Field>
          <Field label="Replace Access-Control-Allow-Origin header" for="select-change-acao"><Select id="select-change-acao" options={ENABLED} value={String(option.httpOption.replaceAccessControlAllowOrigin ?? false)} onchange={(v) => (option.httpOption.replaceAccessControlAllowOrigin = v === 'true')} /></Field>
          <Field label="Inject request header"><HeaderAppender bind:options={option.httpOption.customRequestHeaders} /></Field>
          <Field label="Inject response header"><HeaderAppender bind:options={option.httpOption.customResponseHeaders} /></Field>
          <Field label="Replace text in body"><BodyReplaceAppender bind:options={option.httpOption.bodyRewriteRules} /></Field>
        {/if}
        <Checkbox id="input-inactive-on-startup" label="Inactive on startup" bind:checked={option.inactiveOnStartup} />
      </div>
    </Card>
  </form>
  <div class="edit-bar">
    <Button variant="primary" disabled={!updatable} onclick={apply}>{option.isSync ? 'Apply and Restart' : 'Start'}</Button>
    {#if option.isSync}<Button variant="danger" onclick={() => (confirmOpen = true)}>Stop and Remove</Button>{/if}
  </div>
  <Modal bind:open={confirmOpen} title="Remove tunnel">Remove tunnel {option.forwardPort}? The external server will be stopped.{#snippet footer()}<Button onclick={() => (confirmOpen = false)}>Cancel</Button><Button variant="danger" onclick={() => { confirmOpen = false; remove(); }}>Remove</Button>{/snippet}</Modal>
  {/if}
  {#if loading}<Loading overlay />{/if}
  <Modal bind:open={alertOpen} title="Tunnel">…</Modal>
  ```
  `PROTOCOLS = [{value: 'tcp', label: 'TCP'}, {value: 'http', label: 'HTTP (http/1.1)'}, {value: 'https', label: 'HTTPS (http/1.1)'}]`, `ENABLED = [{value: 'true', label: 'Enabled'}, {value: 'false', label: 'Disabled'}]`. `httpOption` 이 없으면 `load()` 에서 `emptyOption().httpOption` 으로 채운다.
- 스타일: `.tunnel-edit { display: flex; flex-direction: column; gap: var(--s-4); }`, `.form-stack { display: flex; flex-direction: column; gap: var(--s-4); }`, `.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3); }`, `.notes { margin: var(--s-3) 0 0; padding-left: var(--s-4); font-size: var(--fs-xs); color: var(--ink-2); }`, `.section-title { font-family: var(--ff-display); font-size: var(--fs-lg); margin: var(--s-2) 0 0; }`, `.edit-bar { position: sticky; bottom: 0; z-index: 40; display: flex; gap: var(--s-3); justify-content: flex-end; padding: var(--s-3) 0; margin-top: var(--s-4); background: var(--bg-1); border-top: 1px solid var(--line-0); }`.

### `test/admin/screen-tunnels.test.ts` (편집·추가·삭제 케이스 추가)

수용 기준 참조. 각 케이스는 새 `startAdminApp({fixture: 'with-tunnels'})` 로 시작한다.

## 변경할 것

- `admin/src/App.svelte`: `tunnel-edit` 분기를 `<TunnelEditScreen param={$route.param ?? 'new'} />` 로. `TunnelOptionSetLayout` import 삭제. `{#key $route.param}` 로 감싸 포트가 바뀌면 다시 마운트되게 한다.
- `admin/test/configuration.ts`: `mount: (kind: string, param?: string)` — `'server'` 면 `ServerSettingsScreen`, 아니면 `mount(TunnelEditScreen, {target: document.body, props: {param: param ?? 'new'}})`. 처음 호출 시 `mount(Toast, {target: document.body})` 를 한 번 수행한다(토스트 문구를 테스트가 읽는다). `unmount` 는 편집기만 내린다.
- `test/admin/configuration-editor.test.ts` 62행: `mount("tunnel")` → `mount("tunnel", port)` 로 `page.evaluate((port) => (window as any).configurationFixture.mount("tunnel", port), String(oldPort))`.
- `test/admin/compound-stale-rename.test.ts` 24행: `mount("tunnel", String(sourcePort))`; 33행 `locator("#sdf")` → `locator("#input-tls")`.
- `test/admin/configuration-certificate-conflict.discovery.test.ts` 25행: `mount("tunnel", String(forwardPort))`.
- `test/admin/server-buffer-minimum.test.ts` 17행: `mount('tunnel', String(port))`.
- 삭제: `admin/src/layout/TunnelOptionSetLayout.svelte`, `admin/src/layout/HeaderAppender.svelte`, `admin/src/layout/BodyReplaceAppender.svelte`. 이로써 `admin/src/layout/` 은 빈 디렉터리가 되어 Git 에서 사라진다.

## 하지 말 것

- 컨트롤러(`ServerOptionCtrl`, `CertificationCtrl`) 수정 금지. 백엔드 수정 금지.
- `HeaderAppender`·`BodyReplaceAppender` 의 빈 행(name·value 가 모두 빈 항목)이 저장 본문에 그대로 포함되는 것은 옛 동작과 같다. D14 에 따라 유지하고 빈 행 필터를 추가하지 않는다. 결함으로 보이면 이슈 코멘트로 보고만 한다.
- 저장 요청의 `compound` 인자(`certInfo`, `expectedCertificateRevision`, `previousForwardPort`) 계산식을 바꾸지 않는다(4개 기존 테스트가 정확한 값을 검사한다).
- 저장 성공 뒤 목록을 다시 불러오는 대신 `#/tunnels` 로 이동하는 것 외에는 흐름을 바꾸지 않는다.
- 새 터널의 기본값(임의 포트, 127.0.0.1:8080, 버퍼 10/10)을 바꾸지 않는다.
- HTTP 옵션을 `Tabs` 나 접힘 영역으로 숨기지 않는다(옛 화면처럼 프로토콜이 http/https 일 때 펼쳐 보인다).
- 기존 테스트 케이스 삭제·`skip` 금지. 바꾸는 것은 위 목록의 `mount` 호출과 `#sdf` 선택자뿐이다.
- `export let`, `createEventDispatcher`, `on:` 디렉티브, `{@html}`, `bind:this` 로 자식 부품 메서드 호출 금지.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/admin/screen-tunnels.test.ts` (`with-tunnels`)
  - `#/tunnels/20001`: `h1` "Tunnel 20001", `#input-external-port` 값 "20001", `#select-protocol` 값 "tcp", `#input-tls` 미체크·활성, `#input-destination-host` "127.0.0.1", `#input-buffer-limit-client` "8", "Stop and Remove" 버튼 존재, "Apply and Restart" 버튼 enabled, "HTTP options" 헤딩 없음.
  - `#input-destination-host` 를 "10.0.0.9" 로 바꾸고 "Apply and Restart" → `.toast.pulse .msg` 가 "Success to apply tunneling option" → `location.hash === '#/tunnels'` → `calls()` 중 `method === 'applyTunnelingOption'` 이 정확히 1건이고 `args[0].forwardPort === 20001`, `args[0].destinationAddress === '10.0.0.9'`. `li[data-port]` 는 2개.
  - `#/tunnels/20002`(http): "HTTP options" 헤딩, `#select-change-host-in-body` 값 "true", `#select-change-acao` 값 "false", "Inject request header" 아래 `.rule` 1개(빈 행), "Replace text in body" 아래 "Add" 버튼. `#input-tls` 가 disabled. `#select-protocol` 을 "tcp" 로 바꾸면 "HTTP options" 가 사라지고 `#input-tls` 가 enabled.
  - `#/tunnels/20002` 에서 "Stop and Remove" → `getByRole("dialog", {name: "Remove tunnel"})` 에 "Remove tunnel 20002?" → "Remove" → `.toast.pulse .msg` 가 "Tunneling option has been removed. The external server has been shut down." → `#/tunnels` 에 `li[data-port]` 1개(20001) → `calls()` 에 `{method: 'stopExternalPortServer', args: [20002, true]}` 가 있다.
  - 새 터널 케이스는 시작 시 `net.createServer().listen(20003, '127.0.0.1')` 로 포트가 비어 있음을 확인하고 곧바로 닫는다. 점유돼 있으면 `throw new Error('Port 20003 is busy')` 로 실패시킨다(`skip` 금지. `AdminServer.ts` 709행의 `UsablePortChecker` 가 실제로 바인딩 검사를 한다).
  - `#/tunnels/new`: `h1` "New tunnel", "Stop and Remove" 버튼 없음, 버튼 문구 "Start", `#input-destination-host` "127.0.0.1", `#input-destination-port` "8080". `#input-external-port` 에 "20003" 입력 후 "Start" → 토스트 "Success to apply tunneling option" → `#/tunnels` 에 `li[data-port]` 3개이고 `li[data-port="20003"]` 이 있다.
  - `#/tunnels/new` 에서 `#input-buffer-limit-server` 를 "0" 으로 → `.err-msg` "Server buffer must be a finite number of at least 1 MiB." 표시, "Start" disabled.
  - `#/tunnels/65534`(없는 포트) → `location.hash === '#/tunnels'`.
  - `#input-external-port` 에 "70000" → 값 "65535". `#input-buffer-limit-client` 에 "-5" → "-1".
  - `errors` 가 빈 배열이다.
- 기존 테스트 4개 파일(`configuration-editor`, `compound-stale-rename`, `configuration-certificate-conflict.discovery`, `server-buffer-minimum`)이 `mount('tunnel', port)` 로 새 화면을 마운트해 그대로 통과한다: "Apply and Restart" 클릭 → 토스트 문구(`/Success to apply/`, `/Fail/`, `/Configuration changed/`), 요청 1건 `POST /api/tunnelingOption`, `expectedCertificateRevision` 값, `#input-external-port` 값 유지, 오류 문구 exact, 안내문 exact.
- `admin/src/layout/` 디렉터리가 존재하지 않는다(`screen-tunnels.test.ts` 첫 케이스에서 `fs.existsSync` false).

기존 `test/admin/*.test.ts` 전부 통과.

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npm --prefix admin run check
npm run test:admin
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U1-07(`InputCertFile`), U1-08(`TunnelsScreen`, `screen-tunnels.test.ts` 를 만든다. 병렬 진행 시 U1-08 을 먼저 병합한 뒤 이 이슈가 같은 파일에 케이스를 덧붙인다).
- 후행: U1-10.

## 근거 문서

- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §5.2(허용된 동작 차이: 새 터널 삭제 버튼 숨김), §7.4(TunnelEditScreen), §8.3(`screen-tunnels.test.ts` 편집·추가·삭제), §9(U1-09)
- `docs/design/2026-09-11-program-overview.md` §1 D3·D5·D7·D14, §3.3(테스트 삭제 금지)

---
## U1-10

**title**: chore(admin): 부트스트랩·옛 부품·빌드 부산물 제거와 배포 산출물 확인
**labels**: enhancement, area:frontend, unit:1
**body**:
## 목적

단위 1 을 마감한다. 더 이상 참조되지 않는 옛 파일(부트스트랩 CSS, `component/`, `lib/`, 빌드 부산물, 미사용 이미지)을 지우고, 구조 규칙 R1~R7 을 전부 활성화하며, 배포 빌드(`node deploy.js`)의 산출물에 서체 파일이 포함되는지 확인한다. 이 이슈가 끝나면 `admin/src` 에는 `app.css`, `main.ts`, `App.svelte`, `router.ts`, `assets/`, `controller/`, `util/`, `shell/`, `ui/`, `screens/`, `vite-env.d.ts` 만 남는다.

## 배경

- Git 에 추적되는 잔재(`git ls-files` 로 확인됨): `admin/src/css/bootstrap.min.css`(어디에서도 import 되지 않음), `admin/src/component/AlertLayout.svelte`·`Gauge.svelte`·`Loading.svelte`·`Switch.svelte`·`Timer.svelte`(U1-02·03 이 `ui/` 로 대체), `admin/src/lib/Counter.svelte`(Vite 템플릿 잔재), `admin/src/assets/svelte.svg`(템플릿 잔재), `admin/src/main.js`·`admin/src/main.js.map`(옛 빌드 부산물; `admin/.gitignore` 에 없음).
- `admin/src/layout/` 은 U1-05~09 가 파일을 모두 지워 비어 있다(존재하지 않아야 한다).
- 이미지 자산: `admin/src/assets/loading.png` 는 `ui/Loading.svelte` 가 쓴다. `cpu.png`·`uptime.png`(옛 `ServerStatusLayout`), `infinity.png`(옛 `Timer`)은 새 화면이 쓰지 않는다. `icon.png` 는 `admin/src`·`admin/index.html`·`admin/test` 어디에서도 참조되지 않는다(grep 결과 0건).
- 마지막 옛 부품 사용처: `admin/test/fixture.html`(16줄)이 `/src/component/AlertLayout.svelte` 를 `props: {show: true, button: 'Dismiss test alert'}` 로 마운트하고, `test/admin/browser-smoke.test.ts` 가 그 페이지에서 "Dismiss test alert" 버튼을 클릭해 사라짐을 확인한다. 이 스모크 테스트는 유지하고 fixture 만 `ui/Modal` 로 바꾼다.
- `admin/src/controller/GlobalCounter.ts` 는 옛 `Timer` 만 썼다. 설계는 `controller/` 를 변경하지 않는다고 했으므로 지우지 않고 코멘트로 보고한다.
- `admin/package.json` `dependencies`: `lodash`(`ObjectUtil.ts`, `ServerSettingsScreen`, `InputCertFile` 이 `cloneDeep` 사용), `node-forge`(`InputCertFile`), `@types/lodash`. 셋 다 사용 중이라 제거할 것이 없다. `test/admin/crypto-replacement.test.ts` 가 `crypto-js` 부재를 검사한다.
- 구조 규칙 테스트 `test/admin/design-system-rules.test.ts`: R2 가 `NEW_DIRS = ['ui', 'shell', 'screens']` 만 검사한다(U1-02). R6 은 아직 없다.
- 배포 스크립트 `deploy.js`: `npm ci`(루트·admin) → `test:browser:install` → `admin check` → `build --force` → `npm test -- --runInBand` → `admin build`(production) → `admin/dist` 를 `dist/web` 과 `dist.js/web` 으로 복사 → `--skip-binaries` 가 없으면 `pkg`. Vite 는 `app.css` 의 `url("./assets/fonts/*.woff2")` 를 `dist/assets/<이름>-<해시>.woff2` 로 옮기고 CSS 에서 참조한다(index.html 은 CSS 파일을, CSS 가 woff2 를 참조한다).
- 프로덕션 빌드를 테스트에서 돌리는 방식: `test/admin/entrypoint.test.ts` 21~26행이 `spawnSync(process.execPath, [admin/node_modules/vite/bin/vite.js, "build"], {cwd: admin, env: {NODE_ENV: "production"}})` 로 빌드한다.
- CI `.github/workflows/code-regression.yml` 은 `npm test -- --runInBand` 전체를 돌린다.

먼저 열어 볼 파일: `admin/test/fixture.html`, `test/admin/browser-smoke.test.ts`, `test/admin/design-system-rules.test.ts`, `test/admin/entrypoint.test.ts`, `deploy.js`, `admin/package.json`, `admin/.gitignore`.

## 적용되는 결정

- D2 부트스트랩 CSS 제거.
- D6 서체는 번들에 포함, 외부 요청 없음 → 배포 산출물에서 확인.
- D14 동작 변경 없음(이 이슈는 삭제와 검증만).

## 만들 것

### `admin/test/SmokeFixture.svelte` (신규, 룬)

```svelte
<script lang="ts">
  import Modal from '../src/ui/Modal.svelte';
  import Button from '../src/ui/Button.svelte';
  let open = $state(true);
</script>
<Modal bind:open title="Smoke test">
  <p>Smoke body</p>
  {#snippet footer()}<Button variant="primary" onclick={() => (open = false)}>Dismiss test alert</Button>{/snippet}
</Modal>
```

### `test/admin/design-system-rules.test.ts` (R6 추가, R2 범위 확장)

- R6: 다음 경로가 존재하지 않는다 — `admin/src/css`, `admin/src/layout`, `admin/src/component`, `admin/src/lib`, `admin/src/main.js`, `admin/src/main.js.map`, `admin/src/assets/svelte.svg`, `admin/src/assets/cpu.png`, `admin/src/assets/uptime.png`, `admin/src/assets/infinity.png`, `admin/src/assets/icon.png`.
- R2: `NEW_DIRS` 제한을 없애고 `admin/src/**/*.svelte` 전체(`App.svelte` 포함)를 `/(?<![\w-])#[0-9a-fA-F]{3,8}(?![\w-])/` 로 검사한다.
- R5: U1-01 이 둔 임시 제외(`admin/src/css/`, `admin/src/layout/`, `admin/src/component/`, `admin/src/assets/svelte.svg`)를 지우고 `admin/src/**` + `admin/index.html` 전체를 검사한다. 영구 예외는 `admin/src/assets/fonts/LICENSE.md` 하나만 남긴다. 옛 URL 의 원인(`ServerSetLayout.svelte` 153~165행 리터럴, `svelte.svg`)은 U1-07 과 이 이슈가 없앴으므로 통과해야 한다.
- R1·R3·R4·R7 은 그대로.

### `test/admin/build-assets.test.ts` (신규)

`entrypoint.test.ts` 와 같은 방식으로 `vite build`(production) 를 실행한 뒤:
- `admin/dist/index.html` 이 존재하고 `<link rel="stylesheet"` 로 `/assets/*.css` 를 참조한다.
- `admin/dist/assets/` 에 이름이 `noto-serif-latin-400`, `noto-serif-latin-600`, `noto-sans-latin-400`, `noto-sans-latin-500`, `noto-sans-latin-700`, `jetbrains-mono-latin-400`, `jetbrains-mono-latin-500` 으로 시작하고 `.woff2` 로 끝나는 파일이 각 1개씩 있다.
- `admin/dist/assets/*.css` 를 모두 이어 붙인 문자열에서 `/url\([^)]*\.woff2\)/g` 매치가 정확히 7건이고, 그 7개 파일명이 모두 들어 있다.
- `admin/dist/**` 의 `.html`·`.css`·`.js` 에 `fonts.googleapis.com`, `fonts.gstatic.com`, `bootstrap` 문자열이 없다.
타임아웃 60_000.

## 변경할 것

- 삭제(`git rm`): `admin/src/css/bootstrap.min.css`, `admin/src/component/`(5개), `admin/src/lib/Counter.svelte`, `admin/src/assets/svelte.svg`, `admin/src/assets/cpu.png`, `admin/src/assets/uptime.png`, `admin/src/assets/infinity.png`, `admin/src/assets/icon.png`, `admin/src/main.js`, `admin/src/main.js.map`. 삭제 전에 `grep -rn "<파일명>" admin/src admin/test admin/index.html` 로 참조 0건을 확인한다. 참조가 있으면 삭제하지 말고 코멘트로 보고한다.
- `admin/.gitignore`: `src/main.js` 와 `src/main.js.map` 두 줄을 추가해 부산물이 다시 추적되지 않게 한다.
- `admin/test/fixture.html`: `import AlertLayout from '/src/component/AlertLayout.svelte'` 와 Svelte 4 호환 분기(`svelte.mount ? … : new AlertLayout(options)`)를 지우고 `import {mount} from 'svelte'; import SmokeFixture from './SmokeFixture.svelte'; mount(SmokeFixture, {target: document.getElementById('fixture')});` 로 바꾼다. `test/admin/browser-smoke.test.ts` 는 변경 없음.
- `test/admin/design-system-rules.test.ts`: 위와 같이.
- `admin/package.json`: 변경 없음(사용 중인 의존성뿐). 변경할 것이 없다는 사실을 PR 본문에 적는다.

## 하지 말 것

- `controller/*.ts`, `util/hash.ts` 삭제·수정 금지(`GlobalCounter.ts` 미사용은 코멘트로만 보고).
- `loading.png` 삭제 금지(`ui/Loading.svelte` 가 쓴다).
- `deploy.js`, `vite.config.ts`, `.github/workflows/*` 수정 금지.
- `admin/package.json` 의 의존성 버전 변경·추가 금지.
- 테스트 케이스 삭제·`skip` 금지. `browser-smoke.test.ts` 는 한 글자도 바꾸지 않는다.
- `NEW_DIRS` 제한을 남겨 두지 않는다.

## 수용 기준

먼저 쓰고 붉은 상태를 확인할 테스트:

- `test/admin/design-system-rules.test.ts`
  - R6: 위 11개 경로 중 하나라도 존재하면 실패한다.
  - R2: `admin/src/**/*.svelte` 어느 파일에든 hex 리터럴이 있으면 실패한다.
  - R1·R3·R4·R5·R7 이 그대로 통과한다.
- `test/admin/build-assets.test.ts`
  - 프로덕션 빌드가 exit 0 이고 stderr 에 `[vite-plugin-svelte]` 문자열이 없다(현재 빌드도 a11y 경고를 stderr 에 내므로 "stderr 가 빈 문자열" 단언은 하지 않는다. 새 부품의 오버레이 `div` 는 `svelte-ignore` 주석으로 경고를 막는다).
  - `admin/dist/assets/` 에 위 7개 woff2 가 각 1개씩 있고, 빌드된 CSS 의 `url(` … `.woff2)` 참조가 정확히 7건이다.
  - `admin/dist` 의 텍스트 파일에 `fonts.googleapis.com`, `fonts.gstatic.com`, `bootstrap` 이 없다.
- `test/admin/browser-smoke.test.ts` 가 새 fixture 로 그대로 통과한다("Dismiss test alert" 버튼 클릭 → 사라짐, `errors` 빈 배열).
- `test/admin/*.test.ts` 전부(단위 1 이 추가한 `design-system-rules`, `fonts`, `ui-kit`, `router`, `shell`, `screen-login`, `screen-status`, `screen-tunnels`, `screen-server-settings`, `build-assets` 와 기존 13개) 통과.
- `npm test -- --runInBand` 전체 통과(그 전에 `npm run build` 와 `npm run test:browser:install` 을 먼저 실행한다. 프로세스 E2E 가 `build/src/app.js` 를, 브라우저 테스트가 Chromium 을 쓴다). `node deploy.js --skip-binaries` 가 exit 0 으로 끝나고 `dist/web/index.html` 과 `dist/web/assets/*.woff2` 7개가 존재하며 `dist/web/assets/*.css` 의 `url(` … `.woff2)` 참조가 7건이다(수동 확인, 검증 명령 참조).

## 검증 명령

```
npm ci --include=dev && npm --prefix admin ci --include=dev
npm run test:browser:install
npm run build
npm run lint
npm --prefix admin run check
npm run test:admin
npm test -- --runInBand
node deploy.js --skip-binaries
ls dist/web/index.html dist/web/assets/*.woff2     # index.html 1개, woff2 7개
grep -o "url([^)]*\.woff2)" dist/web/assets/*.css | wc -l   # 7
git ls-files admin/src/css admin/src/layout admin/src/component admin/src/lib admin/src/main.js admin/src/main.js.map   # 출력 0줄
git log -1 --format=%B   # Co-Authored-By, Generated, 🤖 등 서명 0건 확인
```

## 선행 · 후행

- 선행: U1-09(옛 터널 레이아웃 삭제로 `layout/` 이 비어 있어야 한다), U1-06·U1-07(옛 상태·설정 레이아웃 삭제).
- 후행: U3-01(RBAC 화면이 `ui/`·`shell/` 위에 얹힌다). 단위 1 의 마지막 이슈.

## 근거 문서

- `docs/design/2026-09-11-unit1-admin-ui-shell.md` §3(지우는 것 목록), §8.1(R6, R2 범위), §9(U1-10)
- `docs/design/2026-09-11-program-overview.md` §1 D2·D6·D14, §3.1(완료 시 빌드·lint·전체 테스트 통과), §4 완료 기준
- `deploy.js`, `admin/vite.config.ts`

---
