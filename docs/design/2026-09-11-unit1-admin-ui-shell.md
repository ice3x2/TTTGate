# 단위 1 — 관리자 UI 골격 재작성

| 항목 | 내용 |
|---|---|
| 상위 문서 | [프로그램 개요](./2026-09-11-program-overview.md) |
| 적용 결정 | D2 D3 D4 D5 D6 D7 D14 |
| 선행 단위 | 0 (브라우저 테스트 규약과 `admin-backend-driver` 는 이 단위가 만든다. 0 과 병렬 가능) |
| 후행 단위 | 3 (RBAC 화면은 이 단위의 `ui/`·`shell/` 위에 얹힌다) |
| 대상 디렉터리 | `admin/` (Svelte 5.19, Vite 6, TypeScript 5.9), `test/admin/`, `test/helpers/` |

## 1. 목표와 비목표

**목표.** 관리자 UI 의 외양과 골격을 디자인 시스템으로 바꾸되 동작은 지금과 1:1 로 같게 옮긴다. 이 단위가 끝나면 (a) 부트스트랩이 사라지고, (b) 헤더·드로어·라우터 골격 위에 화면 4개가 각각의 경로로 열리며, (c) 이후 단위가 재사용할 `ui/` 부품 라이브러리와 브라우저 테스트 기반이 갖춰진다.

**비목표.** 백엔드 변경 없음. API 15개(`/api/login`, `validateSession`, `csrfToken`, `version`, `sysInfo`, `sysUsage`, `clientStatus`, `clientSysInfo/:id`, `serverOption`, `serverOptionHash`, `adminCert`, `tunnelingOption`, `externalServerStatuses`, `externalCert/:port`, `tunneling/active/:port`)의 요청·응답 형태 변경 없음. 로그아웃·계정·권한 관련 UI 없음(2·3 단위).

## 2. 현재 상태 (기준 커밋 `5f772fc`)

- `admin/src/App.svelte` 가 세션을 확인한 뒤 `ServerSetLayout`, `ServerStatusLayout`, `TunnelOptionSetLayout` 세 화면을 **한 페이지에 세로로 쌓아** 그린다. 라우팅 없음. `<main>` 이 `position: fixed` 로 화면을 고정한다.
- 전역 스타일은 `admin/src/app.css` 이고, 그 1~7행이 Google Fonts(Ubuntu)를 `@import` 한다(외부 요청). 나머지는 각 컴포넌트의 `<style>` 과 인라인 스타일. `admin/src/css/bootstrap.min.css` 는 어디에서도 import 되지 않는 잔재 파일이다(클래스명 `form-control` 등만 마크업에 남아 있다).
- 컨트롤러(`admin/src/controller/*.ts`)가 API 호출을 담당하며 `AdminRequest.ts` 가 CSRF 쿠키·헤더와 401→`InvalidSession` 예외를 처리한다. **이 층은 그대로 쓴다.**
- 브라우저 테스트 기반: `test/helpers/adminBrowser.ts` 가 `admin/test/server.mjs`(Vite dev/preview 서버)를 포크하고 Playwright Chromium 을 띄운다. `test/admin/login-backend-driver.ts` 가 실제 `AdminServer` 를 임시 루트에서 띄운다(스텁 `TTTServer` = `{}`).
- 디자인 시스템 `docs/design/admin-design-system.html` 의 마지막 절 "The contract" 가 CSS 토큰 표를 정의한다. 문서 자체는 데스크톱(1360px) 기준이고 모바일 내비게이션 패턴은 없다.

## 3. 파일 구조

```
admin/src/
  app.css                 토큰 표 + @font-face + 리셋 + 페이지 기본 규칙 (부트스트랩 대체)
  assets/fonts/           라틴 서브셋 woff2 (아래 4.2)
  main.ts                 변경 없음 (mount(App))
  App.svelte              세션 확인 → LoginScreen 또는 Shell
  router.ts               해시 라우터 (5절)
  shell/
    Shell.svelte          Header + Drawer + <main>. 1024px 은 여기서만
    Header.svelte         메뉴/뒤로 버튼, 화면 제목, 버전 칩
    Drawer.svelte         NAV 항목 목록, 오버레이, 접근성
    nav.ts                NAV 배열 정의 (경로, 제목, 아이콘)
  ui/                     디자인 시스템 기본 부품 (6절). API 호출 금지
  screens/
    LoginScreen.svelte
    StatusScreen.svelte
    TunnelsScreen.svelte
    TunnelEditScreen.svelte
    ServerSettingsScreen.svelte
    parts/                화면 전용 조각 (InputCertFile, SysinfoPopup, HeaderAppender, BodyReplaceAppender)
  controller/             변경 없음
  util/                   변경 없음
```

**지우는 것(이슈 10):** `css/bootstrap.min.css`, `layout/` 전체(`HeaderAppender`·`BodyReplaceAppender`·`InputCertFile`·`SysinfoPopup` 의 원본도 여기), `component/` 전체(`AlertLayout`·`Gauge`·`Loading`·`Switch`·`Timer`), `lib/Counter.svelte`, `assets/svelte.svg`, 빌드 부산물 `src/main.js`·`src/main.js.map`.

**룬 모드.** `svelte.config.js` 에 `compilerOptions.runes` 를 두지 않는다(파일 단위 룬 모드). 새로 쓰는 `ui/`·`shell/`·`screens/` 는 전부 `$props()`·`$state`·`$derived`·`$bindable`·snippet 을 쓰고, 옛 `layout/`·`component/` 의 `export let`·`createEventDispatcher` 는 이식 시 룬으로 바꾼다. U1-04~09 동안 두 방식이 다른 파일에서 공존하는 것은 정상이다.

**테스트 fixture 의 옛 파일 의존.** `admin/test/configuration.ts` 가 `layout/TunnelOptionSetLayout.svelte`·`layout/ServerSetLayout.svelte` 를 직접 mount 하고, 그 위에서 `configuration-editor`·`configuration-snapshot`·`compound-stale-rename`·`configuration-certificate-conflict.discovery`·`server-buffer-minimum` 다섯 테스트가 돈다. `admin/test/login.ts` 는 `layout/Login.svelte` 를, `admin/test/CertificateFixture.svelte` 는 `layout/InputCertFile`·`component/Gauge`·`component/Timer` 를 import 한다. 옛 파일을 지우는 이슈가 이 fixture 를 새 화면·부품으로 바꾼다: U1-03 은 `CertificateFixture.svelte` 의 Gauge·Timer 를 `ui/` 로, U1-05 는 `login.ts` 를 `screens/LoginScreen.svelte` 로, U1-07 은 `CertificateFixture` 의 InputCertFile 과 `configuration.ts` 의 ServerSetLayout mount 를, U1-09 는 `configuration.ts` 의 TunnelOptionSetLayout mount 를 새 화면으로 바꾼다. `admin/test/fixture.html` 은 `component/AlertLayout.svelte` 를 mount 하므로 U1-10 이 `ui/Modal.svelte` 로 바꾼다(`browser-smoke.test.ts` 는 "Dismiss test alert" 버튼 클릭과 `errors` 빈 배열만 단언하므로 Modal 의 footer 버튼에 같은 이름을 준다). 그래서 **모든 Screen 은 Shell 없이 단독 mount 가 가능해야 한다**: `sessionInvalid` 콜백은 `getContext` 가 없으면 no-op 기본값을 쓰고, `TunnelEditScreen` 의 `param` 은 prop 으로도 주입할 수 있어야 한다.

**층 사이 규칙.**
1. `ui/` 는 `props` 와 이벤트만 안다. `fetch`, `adminRequest`, `controller/` import 금지.
2. 색은 토큰(`var(--signal)` 등)으로만. `.svelte` 파일 안에 hex 색상 리터럴 금지. hex 는 `app.css` 에만 있다. 요소 id 는 `[0-9a-f]{3,8}` 만으로 이루어진 이름(`#face`, `#deb`)을 쓰지 않는다(R2 오탐 방지).
3. `Badge`·`Toast`·`Kpi`·`Chip` 의 색 구분은 `tone` prop 하나로 받고 값은 `'signal' | 'pulse' | 'alarm' | 'trace' | 'warn' | 'neutral'` 로 고정한다.
4. `max-width: 1024px` 는 `shell/Shell.svelte` 한 곳에만 쓴다.
5. 외부 URL(`http://`, `https://`)을 `admin/src/**` 와 `admin/index.html` 에 두지 않는다.

이 다섯 규칙은 `test/admin/design-system-rules.test.ts` 가 기계적으로 검사한다(8절).

## 4. 토큰과 서체

### 4.1 토큰 (`app.css`)

디자인 시스템 문서 `<style>` 의 `:root` 블록(19~95행)에 정의된 토큰을 `app.css` 의 `:root` 에 그대로 옮긴다. 마지막 절 "The contract" 표는 요약이라 66개 중 27개만 싣고 있다. 목록:

- 배경: `--bg-0 --bg-1 --bg-2 --bg-3 --bg-mute`
- 선: `--line-0 --line-1 --line-2`
- 글자: `--ink-0 --ink-1 --ink-2 --ink-3`
- 의미색: `--signal --signal-fill --signal-dim --signal-glow`, `--pulse --pulse-fill --pulse-dim --pulse-glow`, `--alarm --alarm-fill --alarm-dim --alarm-glow`, `--trace --trace-dim --trace-glow`, `--warn`
- 서체: `--ff-display --ff-ui --ff-mono` (한국어 별칭 `--ff-kr-*` 는 만들지 않는다. D5)
- 크기: `--fs-xs --fs-sm --fs-md --fs-lg --fs-xl --fs-2xl --fs-3xl --fs-4xl --fs-hero`
- 행간: `--lh-tight --lh-snug --lh-body`
- 간격: `--s-1` … `--s-12`
- 모서리: `--r-0 --r-1 --r-2 --r-3`
- 시간·이징: `--dur-1 --dur-2 --dur-3 --dur-4`, `--ease-out --ease-in`

리셋은 `box-sizing: border-box`, `body { margin: 0; background: var(--bg-0); color: var(--ink-0); font: var(--fs-md)/var(--lh-body) var(--ff-ui) }`, `img { max-width: 100% }`, `button, input, select { font: inherit }` 정도로 최소화한다.

### 4.2 서체 (D6)

| 역할 | 서체 | 굵기 | 파일 |
|---|---|---|---|
| `--ff-display` | Noto Serif (Latin) | 400, 600 | `noto-serif-latin-400.woff2`, `noto-serif-latin-600.woff2` |
| `--ff-ui` | Noto Sans (Latin) | 400, 500, 700 | `noto-sans-latin-{400,500,700}.woff2` |
| `--ff-mono` | JetBrains Mono (Latin) | 400, 500 | `jetbrains-mono-latin-{400,500}.woff2` |

- 셋 다 SIL OFL 1.1. `admin/src/assets/fonts/LICENSE.md` 에 각 서체의 저작권 고지와 OFL 전문 링크를 둔다.
- `@font-face` 는 `font-display: swap`, `unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD` (Google Fonts 의 latin 서브셋 범위).
- 대체 스택: `--ff-display: "Noto Serif", Georgia, "Times New Roman", serif`; `--ff-ui: "Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; `--ff-mono: "JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace`.
- 파일 확보 절차: Google Fonts CSS API 는 UA 에 따라 다른 형식을 주므로 Chrome UA 로 받는다. `curl -A "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36" "https://fonts.googleapis.com/css2?family=Noto+Serif:wght@400;600&display=swap"` 응답에서 `/* latin */` 주석 바로 아래 블록의 `src: url(...)` 을 받아 저장한다. Noto Sans(`wght@400;500;700`)·JetBrains Mono(`wght@400;500`)도 같은 방식. 파일 하나가 64KB 를 넘으면 라틴 범위가 아닌 블록을 고른 것이다.

## 5. 라우터와 골격

### 5.1 `router.ts`

```ts
export type Screen = 'status' | 'tunnels' | 'tunnel-edit' | 'server';
export type Route = {screen: Screen; param?: string};   // tunnel-edit: param = 'new' | 외부 포트 문자열
export const route: Readable<Route>;                     // Svelte store
export function navigate(hash: string): void;            // location.hash 갱신 → route 갱신
export function parseHash(hash: string): Route;          // 순수 함수. 단위 테스트 대상
```

| 해시 | Route |
|---|---|
| `#/status`, `#/`, 빈 값, 알 수 없는 값 | `{screen:'status'}` |
| `#/tunnels` | `{screen:'tunnels'}` |
| `#/tunnels/new` | `{screen:'tunnel-edit', param:'new'}` |
| `#/tunnels/<1..65535 정수>` | `{screen:'tunnel-edit', param:'<포트>'}` |
| `#/tunnels/<그 외>` | `{screen:'tunnels'}` |
| `#/server` | `{screen:'server'}` |

`hashchange` 이벤트로 store 를 갱신한다. 외부 라이브러리 없음. `parseHash` 를 Jest(ts-jest, CommonJS)가 import 해야 하므로 `router.ts` 는 `svelte` 를 import 하지 않는 순수 모듈로 두고, store 는 최소 구독 함수를 직접 구현한다.

### 5.2 `App.svelte`

```
onMount: LoginCtrl.validateSession() → 'Valid' | 'Invalid'
'Checking' → <Loading/> 전체 화면
'Invalid'  → <LoginScreen onsuccess={() => state='Valid'}/>   // 룬 부품이므로 이벤트가 아니라 콜백 prop
'Valid'    → <Shell> {#if route.screen === ...} 각 Screen {/if} </Shell>
```

- 어떤 Screen 이든 `InvalidSession` 을 잡으면 `sessionInvalid()` 콜백(컨텍스트로 제공)을 부르고, App 은 상태를 `'Invalid'` 로 바꾼다. 해시는 유지하므로 재로그인 뒤 같은 화면으로 돌아간다.
- 지금 `Login.svelte` 의 `window.location.href = '/'` 새로고침은 제거한다. 이 단위에서 허용되는 동작 차이는 이것과, 새 터널 편집 화면에서 삭제 버튼을 숨기는 것(7.4; 기존 `TunnelOptionSetLayout.svelte` 는 새 옵션에도 Remove 를 보인다) 두 가지뿐이다.

### 5.3 `Shell.svelte`

- `<main>`: `width: 100%; max-width: 1024px; margin: 0 auto; padding: var(--s-4)` (`min-width: 640px` 에서 `padding: var(--s-6)`). 문서 스크롤 사용(`position: fixed` 금지).
- 헤더 아래 본문 시작. 본문 하단에 `padding-bottom: var(--s-10)` 을 두어 하단 고정 바(TunnelEdit)가 내용을 가리지 않게 한다.
- `Shell` 은 `title` prop 과 `back` prop(`string | undefined`, 값이 있으면 헤더 메뉴 버튼이 뒤로 가기 화살표가 되고 그 해시로 이동)을 받는다. 각 Screen 이 `<Shell title="Tunnels">` 형태가 아니라, App 이 route 에 따라 title/back 을 계산해 Shell 에 넘긴다.

| screen | title | back |
|---|---|---|
| status | Status | — |
| tunnels | Tunnels | — |
| tunnel-edit (new) | New tunnel | `#/tunnels` |
| tunnel-edit (port) | Tunnel <port> | `#/tunnels` |
| server | Server settings | — |

### 5.4 `Header.svelte`

- `position: sticky; top: 0; height: 56px; background: var(--bg-1); border-bottom: 1px solid var(--line-0)`.
- 왼쪽: 메뉴 버튼(`aria-label="Open menu"`, `aria-expanded`, 탭 영역 44×44) 또는 뒤로 버튼(`aria-label="Back"`).
- 제목: `font-family: var(--ff-display); font-size: var(--fs-xl)`.
- 오른쪽: 버전 칩(`Chip`, mono, `--ink-2`). 값은 `ServerStatusCtrl.getVersion()` → `"{name} {build}"`. 실패 시 빈 칩 숨김.

### 5.5 `Drawer.svelte`

- 왼쪽에서 슬라이드, 너비 `min(320px, 85vw)`, `transition: transform var(--dur-2) var(--ease-out)`. 오버레이 `background: var(--ink-0); opacity: .4`.
- 닫힘 조건: 오버레이 클릭, `Escape`, 항목 선택, `route` 변경.
- 열릴 때 첫 항목으로 초점 이동, 닫힐 때 메뉴 버튼으로 초점 복귀. `role="dialog" aria-modal="true" aria-label="Navigation"`.
- 항목은 `nav.ts` 의 `NAV: Array<{hash: string; title: string; screen: Screen}>` 를 순회한다. 이 단위의 NAV 는 `[status, tunnels, server]` 세 개. 현재 항목은 `aria-current="page"` 와 왼쪽 3px `--signal` 막대.
- 로그아웃 항목 없음(백엔드에 로그아웃 API 가 없다. 2 단위가 추가).

## 6. `ui/` 부품 계약

Svelte 5 룬(`$props`, `$bindable`) 사용. 모든 부품은 `class` prop 을 받아 루트 요소에 덧붙인다. 아래 표의 prop 만 제공한다(그 이상은 만들지 않는다).

| 부품 | props | 이벤트/슬롯 | 디자인 시스템 대응 |
|---|---|---|---|
| `Button` | `variant: 'primary'\|'ghost'\|'danger' = 'ghost'`, `size: 'sm'\|'md' = 'md'`, `disabled`, `type: 'button'\|'submit' = 'button'` | `onclick`, children | `.btn .btn.primary .btn.ghost .btn.danger .btn.sm` |
| `Field` | `label: string`, `hint?: string`, `error?: string`, `for?: string` | children(입력 요소) | `.field .label .hint .err-msg` |
| `TextInput` | `value: $bindable<string>`, `id`, `type: 'text'\|'password' = 'text'`, `placeholder`, `disabled`, `autocomplete?: FullAutoFill`(`svelte/elements` 의 타입), `invalid?: boolean`, `inputmode?: 'text'\|'numeric'` | `oninput`, `onkeydown` | `.input` |
| `NumberInput` | `value: $bindable<number \| null>`(Svelte 5 에서 빈 값은 `null`), `id`, `min`, `max`, `step`, `disabled`, `invalid?` | `oninput` | `.input .mono` |
| `Select` | `value: $bindable<string>`, `id`, `options: Array<{value: string; label: string}>`, `disabled` | `onchange` | `.select` |
| `Checkbox` | `checked: $bindable<boolean>`, `id`, `label: string`, `disabled` | `onchange` | 체크박스 + 라벨 |
| `Switch` | `on: $bindable<boolean>`, `disabled`, `ariaLabel` | `onchange(on)` | `.switch .switch.on` |
| `Card` | `label?: string`(카드 상단 소제목), `ticked?: boolean`, `compact?: boolean`(안쪽 여백 `--s-3`) | children, `header` 스니펫 | `.card .card-label .card-body .card.ticked` (`compact` 는 신규) |
| `Chip` | `tone = 'neutral'`, `mono?: boolean` | children | `.chip` |
| `Badge` | `tone` | children | `.badge` + `.signal .pulse .alarm .trace`(문서에 있음), `.warn .neutral`(신규: `--warn`, `--ink-2`) |
| `Kpi` | `label`, `value: string`, `sub?: string`, `accent?: boolean` | — | `.kpi .kpi.accent` |
| `Gauge` | `title`, `value: number`, `max = 100`, `message: string`, `duration = 900` | — | `.gauge .gauge-val` (기존 `component/Gauge.svelte` 의 애니메이션 로직 유지, 스타일만 교체) |
| `Tabs` | `items: Array<{id: string; label: string}>`, `active: $bindable<string>` | `onchange(id)` | `.tabs .tab .tab.active` |
| `Modal` | `open: $bindable<boolean>`, `title`, `closeOnOverlay = true` | children, `footer` 스니펫 | 문서의 "Overlays explain, then commit" 절 시안. 클래스는 신규(`.modal .modal-head .modal-body .modal-foot`) |
| `Toast` | — (스토어 구독) | — | `.toast .toast.pulse …` |
| `toast` 스토어 | `toast.push({tone, message, timeoutMs = 4000})`, `toast.dismiss(id)` | — | — |
| `Loading` | `overlay?: boolean` | — | 기존 `component/Loading.svelte` 스피너 유지 |
| `Banner` | `tone`, `dismissible?: boolean` | children, `ondismiss` | 신규. 헤더 아래 전체 폭 띠(3 단위 마이그레이션 안내 등) |
| `Timer` | `seconds: number`(남은 초, 일반 prop), `total: number` | `onchange(seconds)` | 기존 `component/Timer.svelte` 의 일·시·분 입력과 카운트다운 로직 유지 |

- `Modal` 은 열릴 때 첫 포커스 가능 요소로 초점을 옮기고 `Escape` 로 닫히며 `role="dialog" aria-modal="true"` 를 단다. 모서리는 `--r-3`(디자인 시스템: r-3 는 모달에만). `Modal`·`Drawer` 의 오버레이 `<div onclick>` 에는 바로 앞에 `<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->` 를 둔다(vite 빌드 stderr 에 `[vite-plugin-svelte]` 경고가 남지 않게).
- `Toast` 는 `Shell` 이 한 번만 마운트한다. 화면 오른쪽 아래(모바일에서는 하단 중앙) 고정, 최대 3개 표시.
- 진열 페이지 `admin/test/ui-fixture.html` + `admin/test/UiFixture.svelte` 가 모든 부품을 한 페이지에 놓는다. 브라우저 테스트 `test/admin/ui-kit.test.ts` 가 이 페이지를 연다(8절).

## 7. 화면별 구성

동작은 기존 코드(`admin/src/layout/*.svelte`)와 같다. 아래는 각 화면의 부품 배치와, 기존 코드에서 반드시 옮겨야 하는 동작 목록이다. 구현자는 기존 파일을 열어 함수 단위로 옮긴다.

### 7.1 LoginScreen (← `layout/Login.svelte`)

- 골격 없이 단독. 세로 중앙 `Card`(최대 너비 400px, 좌우 여백 16px). 제목 "Sign in"(display 서체).
- `Field label="Password"` + `TextInput type="password" id="login-password"`.
- `bootstrapRequired` 가 true 가 되면 `Field label="Bootstrap token" hint="Read the token from config/.bootstrap-token on the server."` + `TextInput type="password" id="bootstrap-token" autocomplete="off"`.
- 오류 문구: `<p id="login-message" role="alert">` `--alarm` 색. 문구와 분기는 기존 코드 그대로: 빈 비밀번호, 429, `weakPassword`, `invalidBootstrapToken && token 입력`, `bootstrapRequired`(토큰 유무별 두 문구), 기타 `result.message || 'The password is incorrect.'`, 예외 시 'Unable to connect to the server.'.
- `Button variant="primary"` "OK", `_pending` 동안 disabled. Enter 제출.
- 성공: `onsuccess: () => void` 콜백 prop 호출(새로고침 없음). `admin/test/login.ts` 가 노출하는 `window.loginFixture.login(password, token)` 계약은 유지한다.

### 7.2 StatusScreen (← `layout/ServerStatusLayout.svelte`)

- 1초 `setInterval` 로 `getSysUsage()` + `getClientStatus()`. 실패가 `InvalidSession` 이면 `sessionInvalid()`; 그 외 실패에도 기존 코드처럼 폴링을 멈춘다(D14). 언마운트 시 `clearInterval`.
- **컨트롤러 최소 수정 허용:** `admin/src/controller/ServerStatusCtrl.ts` 의 `getSysUsage`·`getSysInfo`·`getClientSysInfo`·`getClientStatus` 는 응답 봉투를 풀지 않는데 `AdminServer` 는 `{sysUsage}`·`{sysInfo}`·`{statuses}` 로 감싼다(`AdminServer.ts:1172·1180·1188·1002`). 이 불일치로 옛 상태 화면은 렌더 시 TypeError 가 난다. U1-06 이 반환문 4곳만 고친다("컨트롤러 변경 없음" 의 유일한 예외).
- 상단 행: `Button variant="ghost" size="sm"` "INFO"(→ `getSysInfo()` 후 SysinfoPopup 열기) + `Chip mono` 가동 시간(`_timeToDMH`).
- 게이지 그리드: `grid-template-columns: repeat(2, 1fr)`, 640px 이상 `repeat(4, 1fr)`. CPU(`value=cpu.process`, `max=100`), Memory, Heap, Buffer(각각 `max` = total). 메시지 문자열 형식은 기존과 동일(`_byteToUnit`).
- "Client list" 섹션: 클라이언트마다 `Card`. 내용: `ID: {id}` + 이름(제목), Address, Uptime, Active session. 카드 탭 → `getClientSysInfo(id)` → SysinfoPopup. 목록이 비면 `--ink-2` 문구 "No clients connected."
- SysinfoPopup(`screens/parts/SysinfoPopup.svelte`)은 `Modal` 안에 HW Info / OS Info / Network 세 절. 필드는 기존 `layout/SysinfoPopup.svelte` 와 동일.

### 7.3 TunnelsScreen (← `layout/TunnelOptionSetLayout.svelte` 의 목록·상태 부분)

- 마운트 시 `getTunnelingOption()` 으로 옵션 목록, `loadTunnelingStatus()` 로 상태. 상태 갱신 주기와 실패 처리는 기존 `_startExternalServerStatusUpdate` 와 동일.
- 상단: `Button variant="primary"` "Add tunneling service" → `navigate('#/tunnels/new')`.
- 카드(터널마다 `Card`, `data-port="{forwardPort}"`):
  - 1행: `<span class="mono">{forwardPort}</span> ⬌ {destinationAddress}:{destinationPort}` + `Chip` 프로토콜 대문자.
  - 2행: `Badge` 상태 — 상태 있음&online → `tone="pulse"` "Online"; 상태 있음&!online → `tone="alarm"` "Error"; 상태 없음 → `tone="neutral"` "Offline". online 이면 이어서 mono 로 `Uptime {_startupTime} · Sessions {n} · RX {_toSize} · TX {_toSize}`.
  - 3행(online 일 때만): "Activation" 라벨 + `Switch`(`on=status.active`, 변경 시 기존 `_onChangeActive(on, port)`) + active 이면 "Timeout" 라벨 + `Timer`(기존 `_getTimeout`, 변경 시 `_onChangeActive(true, port, seconds)`).
  - 카드 1·2행 영역 클릭 → `navigate('#/tunnels/' + forwardPort)`. 3행의 스위치·타이머 클릭은 전파를 막는다.
- 목록이 비면 "No tunnels yet." 문구.

### 7.4 TunnelEditScreen (← 같은 파일의 폼 부분)

- `param === 'new'` 면 기존 `_addEmptyOption` 이 만드는 기본값으로 빈 옵션을 만든다(서버에는 저장 버튼을 눌러야 반영). 그 외에는 `getTunnelingOption()` 에서 `forwardPort === Number(param)` 인 항목. 없으면 `navigate('#/tunnels')`.
- 필드 순서와 id 는 기존과 같다: `input-external-port`(NumberInput 1..65535), TLS `Checkbox`(켜면 `InputCertFile` `hideMessage`), `input-destination-host`, `input-destination-port`, `input-allow-client-names`(**세미콜론(;) 구분** 텍스트, 라벨에 "(Separate names with semicolon(;))", 저장 시 `split(";")` — 기존 `TunnelOptionSetLayout.svelte` 로직 그대로), `input-active-timeout`(Keep-Alive Timeout ms), Buffer limit 절(`input-buffer-limit-server` 1 이상 검증 실패 시 `Field error`, `input-buffer-limit-client`), `select-protocol`(tcp/http/https, 변경 시 기존 `_onChangeProtocol`), 프로토콜이 http/https 일 때 "HTTP options" 절: `select-change-host-in-body`, `select-change-acao`, Request headers `HeaderAppender`, Response headers `HeaderAppender`, Body rewrite `BodyReplaceAppender`. 마지막에 `Checkbox` "Inactive on startup".
- 하단 고정 바(`position: sticky; bottom: 0; background: var(--bg-1); border-top: 1px solid var(--line-0)`): 저장 `Button variant="primary"`(문구 `isSync ? 'Apply and Restart' : 'Start'`, `updatable` 아니면 disabled) + 삭제 `Button variant="danger"`(문구 `isSync ? 'Stop and Remove' : 'Remove'`; 새 터널이면 숨김).
- 삭제는 `Modal` 확인("Remove tunnel {port}? …") 후 기존 `_onClickRemove`. 성공하면 `toast.push({tone:'pulse', …})` 후 `navigate('#/tunnels')`.
- 저장 성공·실패 알림은 `toast`. 세션 만료·접속 실패는 기존처럼 `Modal`(확인 후 각각 `sessionInvalid()` / 재시도).
- `HeaderAppender`·`BodyReplaceAppender` 는 `screens/parts/` 로 옮기고 `ui/` 부품으로 재구성한다. `bind:options` 계약은 유지.

### 7.5 ServerSettingsScreen (← `layout/ServerSetLayout.svelte`)

- 필드와 id: `input-key`(Tunnel server-client authentication key), `input-admin-port`(0..65535), Admin TLS `Checkbox`(켜면 `InputCertFile`), `input-tunnel-port`, Tunnel TLS `Checkbox`, `globalMemCacheLimit` NumberInput(1..99999, 라벨 "Memory cache limit (MiB)"), `keepAlive` NumberInput(라벨 "Keep-Alive (ms)").
- 하단: `Button variant="primary"` "Apply"(`_isNewValue` 일 때만 활성), `Button` "Reset".
- 저장 흐름은 기존 `_apply` → `_checkServerRestart`(Loading 표시 → 상태 재확인 → 결과 Modal → 필요 시 재로그인) 그대로.
- `InputCertFile`(`screens/parts/`)은 Key·Cert·CA 파일 입력 3개 + CA 제거 버튼 + 안내문 2줄. 고정 너비(250px) 제거, `width: 100%`.

## 8. 테스트

### 8.1 구조 규칙 테스트 — `test/admin/design-system-rules.test.ts`

Node `fs` 로 `admin/src` 를 읽어 3절의 규칙을 검사한다. 각 규칙이 별도 `test()`.

| 규칙 | 검사 |
|---|---|
| R1 | `admin/src/ui/*.svelte` 내용에 `/fetch\(|adminRequest|from ["']\.\.\/controller/` 없음 |
| R2 | `admin/src/**/*.svelte` 에 `/(?<![\w-])#[0-9a-fA-F]{3,8}(?![\w-])/` 없음 (`<style>` 밖 포함. `#add-user` 같은 id 선택자에 오탐하지 않도록 앞뒤 경계 확인). **U1-10 전까지는** `ui/`·`shell/`·`screens/` 만 검사한다(`App.svelte` 78·106행의 `#fff` 가 U1-04 까지, `layout/`·`component/` 의 hex 가 U1-10 까지 남는다) |
| R3 | `admin/src/app.css` 에 4.1 절 토큰 이름 전부(`--bg-0` … `--ease-in`, 테스트 파일에 배열로 명시) 정의됨 |
| R4 | `max-width: 1024px` 가 `admin/src/shell/Shell.svelte` 한 파일에만 존재 |
| R5 | `admin/src/**` 와 `admin/index.html` 에 `/https?:\/\//` 없음 (주석 포함). **U1-10 전까지는** `css/`, `layout/`, `component/`, `assets/svelte.svg` 를 제외한다(옛 파일에 URL 이 남아 있다). `assets/fonts/LICENSE.md` 는 영구 예외 |
| R6 | `admin/src/css`, `admin/src/layout`, `admin/src/component`, `admin/src/lib`, `admin/src/main.js` 가 존재하지 않음 — **이슈 10 에서 활성화** (그 전에는 `test.skip` 대신 이슈 10 이 추가) |
| R7 | `admin/src/assets/fonts/` 에 4.2 절의 woff2 7개와 `LICENSE.md` 존재, 각 woff2 ≤ 64KB |

### 8.2 백엔드 드라이버 일반화 — `test/admin/admin-backend-driver.ts`

`login-backend-driver.ts` 를 대체한다(기존 파일은 삭제하고 `login-bootstrap.test.ts` 가 새 드라이버를 쓰도록 수정).

- 인자: `[rootDir, fixtureName?]`. `fixtureName` 이 `'with-tunnels'` 면 `rootDir/config/server.yaml` 에 터널 2개(포트 20001 tcp, 20002 http)를 미리 쓰고 `.key` 에 비밀번호 `test-password-1234` 의 bcrypt 해시를 둔다(`SessionStore` 의 해시 방식 그대로). 기본은 부트스트랩 상태.
- 스텁 `TTTServer`: `{activeExternalPortServer, inactiveExternalPortServer, applyTunnelingOption, applyServerOption, applyExternalServerCert, stopExternalPortServer, externalServerStatuses, externalServerStatus, clientStatus, getClientSysInfo, captureRuntimeState, restoreRuntimeState}` 를 호출 기록 배열에 push 하고 결정적 값을 돌려준다. `captureRuntimeState` 는 빈 스냅샷 `{}`, `restoreRuntimeState` 는 `[]` 를 돌려준다(`AdminServer.ts:531/:426/:435` 가 옵셔널로 호출하므로 없어도 동작하지만 복구 경로가 통째로 건너뛰어지지 않게 둔다). `applyTunnelingOption`·`applyServerOption`·`applyExternalServerCert` 는 `RuntimeApplyResult`(`src/server/TTTServer.ts:14`) 형태 `{success: true, partial: false, warnings: [], failedScopes: [], restartRequiredScopes: []}` 를, `activeExternalPortServer`·`inactiveExternalPortServer`·`stopExternalPortServer` 는 `true` 를 돌려준다. `externalServerStatuses` 는 fixture 의 터널마다 `{port, online: true, active: true, sessions: 0, rx: 0, tx: 0, uptime: 1000, activeStart: Date.now(), activeTimeout: 3600}`.
- IPC: 부모가 `{type:'calls'}` 를 보내면 호출 기록을 회신한다. 테스트는 이것으로 "저장 버튼이 `applyTunnelingOption` 을 불렀는가"를 단언한다.
- 헬퍼 `test/helpers/adminApp.ts` 의 `startAdminApp({fixture})` 가 드라이버 포크 + `startAdminBrowser({apiOrigin})` + 로그인까지 수행해 `{page, url, errors, calls(), close}` 를 돌려준다.

### 8.3 브라우저 테스트 (Playwright, 뷰포트 400×800)

| 파일 | 시나리오 |
|---|---|
| `test/admin/ui-kit.test.ts` | `ui-fixture.html` 열기 → Button 클릭 카운트, TextInput 입력 반영, Switch 토글, Modal 열기·Escape 닫기·초점 복귀, Toast push 후 표시·자동 소멸, Tabs 전환. `errors` 비어 있음 |
| `test/admin/shell.test.ts` | (백엔드 없이 `admin/test/shell-fixture.html` 로 검증. "로그인 후 `#/status` 도착" 은 U1-05 의 `screen-login.test.ts` 가 맡는다) 메뉴 버튼 → 드로어 `role=dialog` 표시, 첫 항목에 초점 → "Tunnels" 선택 → 해시 `#/tunnels`, 드로어 닫힘, 초점이 메뉴 버튼 → Escape 로 닫힘. 400px: `<main>` 너비 = 뷰포트 너비, `document.documentElement.scrollWidth === clientWidth`. 1280×800 뷰포트: `<main>` 너비 1024, 좌우 여백 동일 |
| `test/admin/screen-login.test.ts` | 부트스트랩 fixture: 약한 비밀번호 → 문구, 토큰 없이 → 토큰 필드 등장, 잘못된 토큰 → 문구, 올바른 토큰 → `#/status`, `page.url()` 에 새로고침 없음(`page.on('load')` 횟수 1). 비밀번호 fixture: 오답 → "The password is incorrect.", 정답 → 성공 |
| `test/admin/screen-status.test.ts` | 게이지 4개 제목 표시, 가동 시간 칩 표시, INFO → 모달에 "HW Info" → 닫기. 클라이언트 카드(스텁 `clientStatus` 가 1개 반환) 탭 → 모달 |
| `test/admin/screen-tunnels.test.ts` (U1-08 이 목록 케이스로 파일을 만들고 U1-09 가 편집 케이스를 같은 파일에 추가한다. 병렬 진행 시 U1-08 을 먼저 병합) | `with-tunnels`: 카드 2개(`[data-port="20001"]`, `20002`), 배지 "Online", 스위치 on. 카드 클릭 → `#/tunnels/20001` → `#input-external-port` 값 20001, `#select-protocol` tcp. 목적지 호스트 변경 → 저장 → `calls()` 에 `applyTunnelingOption` 1건, 토스트 표시, `#/tunnels` 로 복귀. 삭제 → 모달 → 확인 → 카드 1개. "Add tunneling service" → `#/tunnels/new` → 삭제 버튼 없음 → 포트 20003 입력 후 저장 → 카드 3개 |
| `test/admin/screen-server-settings.test.ts` | 초기 Apply disabled → 키 변경 → enabled → Reset → 원래 값, disabled. Admin TLS 체크 → InputCertFile 등장 |

모든 브라우저 테스트는 `finally` 에서 `close()` 하고 `expect(errors).toEqual([])` 로 끝난다. 기존 `browser-smoke.test.ts` 는 유지한다.

## 9. 이슈 분할

번호 순서로만 진행한다. 각 이슈 종료 시 빌드·lint·`npm run test:admin` 통과.

| # | 제목 | 만드는 것 | 수용 기준 |
|---|---|---|---|
| U1-01 | 디자인 토큰·서체·리셋 이식 | `app.css` 재작성(Google Fonts `@import` 제거 포함), `assets/fonts/*` 7개 + LICENSE, `main.ts` 는 그대로. 기존 화면의 외양이 다소 달라져도(Ubuntu 서체 → 시스템 서체) 허용 | `design-system-rules.test.ts` 의 R3·R5·R7 |
| U1-02 | `ui/` 1차 부품 | Button, Field, TextInput, NumberInput, Select, Checkbox, Switch, Card, Chip, Badge + `UiFixture.svelte`/`ui-fixture.html` | R1·R2, `ui-kit.test.ts` 해당 부분 |
| U1-03 | `ui/` 2차 부품 | Modal, Toast+스토어, Tabs, Kpi, Gauge, Loading, Timer | `ui-kit.test.ts` 나머지 |
| U1-04 | 라우터와 골격 | `router.ts`(+단위 테스트 `test/admin/router.test.ts`: parseHash 표), `shell/*`, `nav.ts`, `App.svelte`. 기존 레이아웃을 경로별로 임시 장착 | R4, `shell.test.ts`, `router.test.ts` |
| U1-05 | 백엔드 드라이버 일반화와 LoginScreen | `admin-backend-driver.ts`, `adminApp.ts`, `LoginScreen.svelte`, `layout/Login.svelte` 삭제 | `screen-login.test.ts`, 기존 `login-bootstrap.test.ts` 통과 |
| U1-06 | StatusScreen | `StatusScreen.svelte`, `parts/SysinfoPopup.svelte`, `layout/ServerStatusLayout.svelte`·`layout/SysinfoPopup.svelte` 삭제 | `screen-status.test.ts` |
| U1-07 | ServerSettingsScreen | `ServerSettingsScreen.svelte`, `parts/InputCertFile.svelte`, 옛 파일 삭제 | `screen-server-settings.test.ts`, 기존 `certificate-lifecycle.test.ts`·`configuration-editor.test.ts` 등 `test/admin` 전체 통과 |
| U1-08 | TunnelsScreen | `TunnelsScreen.svelte`(목록·스위치·타이머) | `screen-tunnels.test.ts` 목록 부분 |
| U1-09 | TunnelEditScreen | `TunnelEditScreen.svelte`, `parts/HeaderAppender.svelte`, `parts/BodyReplaceAppender.svelte`, `layout/TunnelOptionSetLayout.svelte` 등 옛 파일 삭제 | `screen-tunnels.test.ts` 편집·추가·삭제 부분 |
| U1-10 | 옛 코드 제거와 배포 확인 | `css/bootstrap.min.css`(미참조 잔재)·`layout/`·`component/`·`lib/`·부산물 삭제, R5 의 임시 제외 해제와 R6 활성화, `admin/package.json` 의 미사용 의존성 정리(lodash 등은 컨트롤러가 쓰면 유지) | R1~R7 전부, `test/admin` 전체, `node deploy.js` 성공, `dist/web/assets/*.woff2` 7개 존재, 빌드된 CSS 에 `url(` … `.woff2)` 참조 7건(Vite 는 서체를 `assets/<이름>-<해시>.woff2` 로 내보내고 CSS 가 참조한다) |

기존 `test/admin/*.test.ts`(13개)는 화면 선택자를 쓰는 경우 새 화면에 맞게 갱신한다. 어떤 테스트도 삭제하지 않는다. 화면 선택자를 바꿔야 하는 테스트는 해당 화면 이슈에서 함께 고친다.
