// TTTGate 런처 화면(#322). 판단은 Rust(view.rs)가 하고, 이 파일은 그 결과를 그리고 버튼을 Rust 명령에 잇는다.
// 외부 네트워크에서 아무것도 받지 않는다(NFR-4). 모든 파일은 exe 안에 들어 있다.
"use strict";

const STRINGS = {
  ko: {
    chooseTitle: "어떻게 쓰시겠어요?", chooseHelp: "나중에 아래 '모드 바꾸기' 로 바꿀 수 있습니다.",
    serverMode: "서버로 쓰기", serverModeHelp: "이 PC 가 클라이언트를 받고 관리 화면을 엽니다.",
    clientMode: "클라이언트로 쓰기", clientModeHelp: "이 PC 를 서버에 등록하고 내부 네트워크를 연결합니다.",
    joinTitle: "서버에 등록", joinHelp: "관리 화면의 클라이언트 메뉴에서 받은 등록 코드를 넣으세요.",
    serverAddress: "서버 주소", enrollmentCode: "등록 코드", join: "등록", cancel: "취소",
    readyTitle: "등록된 클라이언트", clientId: "클라이언트 ID", server: "서버",
    rejoin: "다른 서버로 다시 등록", startDaemon: "데몬으로 실행",
    serverTitle: "서버 설정", serverHelp: "비워 둔 값은 지금 설정을 그대로 씁니다. 나머지 설정은 관리 화면에서 바꿉니다.",
    adminConsole: "관리 화면", adminPort: "포트", adminBindHost: "열 주소",
    keep: "지금 설정 유지", bindLocal: "이 PC 에서만 (127.0.0.1)", bindAll: "다른 PC 에서도 (0.0.0.0)",
    adminAllowedOrigins: "허용 주소 (도메인·프록시로 열 때)", originsHelp: "한 줄에 하나씩 씁니다. 예: https://gw.example.com:9300",
    controlPortTitle: "클라이언트 연결", controlPort: "제어 포트", controlTls: "TLS", controlProtocolMode: "프로토콜 모드",
    on: "켬", off: "끔", saveAndStart: "저장하고 시작",
    authHint: "연결이 계속 실패합니다. 서버에서 이 클라이언트가 지워졌거나 비밀값이 바뀌었을 수 있습니다. 그렇다면 다른 서버로 다시 등록을 눌러 새 코드로 등록하세요.",
    replaceConfirm: "이 PC 에 이미 등록 정보(config/client.yaml)가 있지만 읽을 수 없거나 예전 방식입니다. 새 코드로 바꾸어 등록할까요? 지금 파일은 client.yaml.bak 으로 남깁니다.",
    tokenHelp: "처음 로그인할 때 이 부트스트랩 토큰으로 관리자 계정을 만듭니다.", copy: "복사", copied: "복사했습니다",
    openLogs: "로그 폴더", openAdmin: "관리 화면 열기", stop: "멈추기",
    autostart: "Windows 로그인 때 자동 시작", changeMode: "모드 바꾸기",
    remoteTitle: "다른 PC 에서 관리 화면을 열까요?",
    remoteBody: "관리 화면이 네트워크의 다른 PC 에도 열립니다. 방화벽으로 접근을 제한하고 강한 비밀번호와 MFA 를 쓰세요.",
    remoteConfirm: "위험을 알고 열기",
    quitTitle: "런처를 끝냅니다", quitBody: "TTTGate 가 실행 중입니다. 어떻게 할까요?",
    quitStop: "TTTGate 도 멈추고 끝내기", quitKeep: "TTTGate 는 계속 두고 끝내기",
    version: (v) => `런처 ${v}`,
    mismatch: (l, c) => `런처(${l})와 TTTGate(${c})의 버전이 다릅니다. 같은 릴리스의 파일을 함께 쓰세요.`,
    cliMissing: "같은 폴더에서 TTTGate-win-x64.exe 또는 TTTGate-win-arm64.exe 를 찾지 못했습니다. 런처를 TTTGate 의 bin 폴더에 두세요.",
    running: { server: "서버 실행 중", client: "클라이언트 실행 중", unknown: "TTTGate 실행 중" },
    connection: { connected: "연결됨", reconnecting: "다시 연결 중", connecting: "연결 중" },
    failures: (n) => `연속 실패 ${n}회`, background: "백그라운드", foreground: "명령 창에서 실행 중",
    joined: (id, server) => `${server} 에 '${id}' 로 등록했습니다.`,
    joinFailed: {
      argument: "주소나 코드 형식이 맞지 않습니다. 코드는 12자리입니다(예: 7Q4K-M2XP-AB01).",
      exists: "이미 등록 정보가 있습니다.",
      rejected: "서버가 코드를 거부했습니다. 틀렸거나, 기한이 지났거나, 이미 쓴 코드입니다. 새 코드를 받으세요.",
      throttled: "실패가 많아 잠시 막혔습니다. 15분 뒤에 다시 하세요.",
      unavailable: "서버가 등록을 받지 않습니다. 서버의 제어 포트가 TLS 를 써야 합니다.",
      network: "서버에 연결하지 못했습니다. 주소와 포트, 방화벽을 확인하세요.",
      proof: "서버 인증서가 맞지 않습니다. 중간에서 다른 장비가 가로챘을 수 있어 아무것도 저장하지 않았습니다.",
      write: "설정 파일을 쓰지 못했습니다. 폴더 권한을 확인하세요.",
      unknown: "등록하지 못했습니다."
    }
  },
  en: {
    chooseTitle: "How will you use this PC?", chooseHelp: "You can change it later with 'Change mode'.",
    serverMode: "Use as a server", serverModeHelp: "This PC accepts clients and opens the admin console.",
    clientMode: "Use as a client", clientModeHelp: "Enroll this PC with a server and connect your internal network.",
    joinTitle: "Enroll with a server", joinHelp: "Enter the code from the Clients page of the admin console.",
    serverAddress: "Server address", enrollmentCode: "Enrollment code", join: "Enroll", cancel: "Cancel",
    readyTitle: "Enrolled client", clientId: "Client ID", server: "Server",
    rejoin: "Enroll with another server", startDaemon: "Run in the background",
    serverTitle: "Server settings", serverHelp: "Empty fields keep the current settings. Change the rest in the admin console.",
    adminConsole: "Admin console", adminPort: "Port", adminBindHost: "Listen on",
    keep: "Keep current", bindLocal: "This PC only (127.0.0.1)", bindAll: "Other PCs too (0.0.0.0)",
    adminAllowedOrigins: "Allowed origins (domain or proxy)", originsHelp: "One per line, for example https://gw.example.com:9300",
    controlPortTitle: "Client connections", controlPort: "Control port", controlTls: "TLS", controlProtocolMode: "Protocol mode",
    on: "On", off: "Off", saveAndStart: "Save and start",
    authHint: "The connection keeps failing. The server may have removed this client or changed its secret. If so, choose Enroll with another server and use a new code.",
    replaceConfirm: "This PC already has enrollment settings (config/client.yaml), but they cannot be read or use the old method. Enroll again with this code? The current file is kept as client.yaml.bak.",
    tokenHelp: "Use this bootstrap token to create the admin account at the first sign-in.", copy: "Copy", copied: "Copied",
    openLogs: "Logs folder", openAdmin: "Open admin console", stop: "Stop",
    autostart: "Start when I sign in to Windows", changeMode: "Change mode",
    remoteTitle: "Open the admin console to other PCs?",
    remoteBody: "Other PCs on the network can reach the admin console. Limit access with a firewall and use a strong password and MFA.",
    remoteConfirm: "Open it anyway",
    quitTitle: "Quit the launcher", quitBody: "TTTGate is running. What do you want to do?",
    quitStop: "Stop TTTGate and quit", quitKeep: "Keep TTTGate running and quit",
    version: (v) => `Launcher ${v}`,
    mismatch: (l, c) => `The launcher (${l}) and TTTGate (${c}) versions differ. Use the files of one release together.`,
    cliMissing: "TTTGate-win-x64.exe or TTTGate-win-arm64.exe is not in this folder. Put the launcher in the bin folder of TTTGate.",
    running: { server: "Server is running", client: "Client is running", unknown: "TTTGate is running" },
    connection: { connected: "Connected", reconnecting: "Reconnecting", connecting: "Connecting" },
    failures: (n) => `${n} failures in a row`, background: "In the background", foreground: "Running in a command window",
    joined: (id, server) => `Enrolled as '${id}' with ${server}.`,
    joinFailed: {
      argument: "The address or the code is not valid. The code has 12 characters, for example 7Q4K-M2XP-AB01.",
      exists: "This PC is already enrolled.",
      rejected: "The server rejected the code. It may be wrong, expired or already used. Ask for a new code.",
      throttled: "Too many failed attempts. Try again in 15 minutes.",
      unavailable: "The server does not accept enrollment. Its control port must use TLS.",
      network: "Cannot reach the server. Check the address, the port and the firewall.",
      proof: "The server certificate does not match. Another host may be in the middle, so nothing was saved.",
      write: "Cannot write the settings. Check the folder permissions.",
      unknown: "Enrollment failed."
    }
  }
};

const T = navigator.language && navigator.language.toLowerCase().startsWith("ko") ? STRINGS.ko : STRINGS.en;
const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const POLL_MS = 3000;
let current = null;

function translate() {
  document.documentElement.lang = T === STRINGS.ko ? "ko" : "en";
  for (const element of $$("[data-t]")) element.textContent = T[element.dataset.t];
}

async function busy(work) {
  $("[data-busy]").hidden = false;
  $$("button").forEach((button) => { button.disabled = true; });
  try {
    return await work();
  } finally {
    $("[data-busy]").hidden = true;
    $$("button").forEach((button) => { button.disabled = false; });
  }
}

function showResult(selector, ok, text) {
  const element = $(selector);
  element.hidden = false;
  element.className = `result ${ok ? "ok" : "error"}`;
  element.textContent = text;
}

function render(state) {
  current = state;
  $("[data-version]").textContent = T.version(state.launcherVersion);
  const mismatch = $("[data-mismatch]");
  mismatch.hidden = !state.versionMismatch;
  mismatch.textContent = state.versionMismatch ? T.mismatch(state.launcherVersion, state.cliVersion) : "";
  const missing = $("[data-cli-missing]");
  missing.hidden = !state.cliMissing;
  missing.textContent = T.cliMissing;

  const screen = state.screen;
  for (const section of $$("[data-screen]")) section.hidden = section.dataset.screen !== screen.screen;
  $("[data-autostart]").checked = state.settings.autostart;
  $("[data-action=changeMode]").hidden = screen.screen === "running" || screen.screen === "chooseMode";

  const token = $("[data-token]");
  token.hidden = !state.bootstrapToken;
  if (state.bootstrapToken) $("[data-token-value]").textContent = state.bootstrapToken;

  if (screen.screen === "clientJoin") {
    $("[data-replacing]").hidden = !screen.replacing;
  } else if (screen.screen === "clientReady") {
    $("[data-field=clientId]").textContent = screen.clientId;
    $("[data-field=server]").textContent = screen.server;
  } else if (screen.screen === "running") {
    renderRunning(screen);
  }
}

function renderRunning(view) {
  const mode = view.mode === "server" || view.mode === "client" ? view.mode : "unknown";
  $("[data-running-title]").textContent = T.running[mode];
  const details = [view.daemon ? T.background : T.foreground, `pid ${view.pid}`];
  if (view.connection) details.unshift(T.connection[view.connection] || view.connection);
  if (view.failures > 0) details.push(T.failures(view.failures));
  $("[data-running-detail]").textContent = details.join(" · ");
  const dot = $("[data-dot]");
  dot.className = `dot ${view.connection === "connected" || mode === "server" ? "ok" : "warn"}`;
  $("[data-auth-hint]").hidden = !view.authHint;
  $$("[data-client-only]").forEach((element) => { element.hidden = mode !== "client"; });
  $$("[data-server-only]").forEach((element) => { element.hidden = mode !== "server"; });
}

async function refresh() {
  render(await invoke("load_view"));
}

function serverOptions(form) {
  const data = new FormData(form);
  const text = (name) => String(data.get(name) || "").trim();
  // 포트는 글자 그대로 넘긴다. 검사는 서버의 기존 검사(server config save)가 하고, 틀리면 그 문장을 보인다.
  const port = (name) => (text(name) === "" ? null : text(name));
  const origins = text("adminAllowedOrigins");
  return {
    adminPort: port("adminPort"),
    adminBindHost: text("adminBindHost") || null,
    // 비워 두면 지금 값을 유지한다. 지우려면 관리 화면에서 지운다.
    adminAllowedOrigins: origins === "" ? null : origins.split(/[\r\n,]+/).map((o) => o.trim()).filter(Boolean),
    controlPort: port("controlPort"),
    controlTls: text("controlTls") === "" ? null : text("controlTls") === "true",
    controlProtocolMode: text("controlProtocolMode") || null
  };
}

function ask(name) {
  const dialog = $(`[data-dialog=${name}]`);
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
    dialog.showModal();
  });
}

async function startServer(form, allowRemote) {
  let result;
  try {
    result = await busy(() => invoke("start_server", { options: serverOptions(form), allowRemote }));
  } catch (error) {
    showResult("[data-server-result]", false, String(error));
    return;
  }
  if (result.needsRemoteConsent && !allowRemote) {
    if ((await ask("remote")) === "ok") return startServer(form, true);
    return;
  }
  if (!result.ok) showResult("[data-server-result]", false, result.message);
  await refresh();
}

/** 멈추고, 실패하면 이유를 알린다. 멈췄으면 true. */
async function stopOrReport() {
  const result = await invoke("stop_daemon");
  if (!result.ok) alert(result.message);
  return result.ok;
}

const ACTIONS = {
  chooseServer: () => invoke("choose_mode", { mode: "server" }),
  chooseClient: () => invoke("choose_mode", { mode: "client" }),
  changeMode: () => invoke("choose_mode", { mode: null }),
  rejoin: async () => {
    if (current && current.screen.screen === "running" && !(await stopOrReport())) return;
    await invoke("set_rejoin", { on: true });
  },
  cancelRejoin: () => invoke("set_rejoin", { on: false }),
  startClient: async () => {
    const result = await invoke("start_client");
    if (!result.ok) alert(result.message);
  },
  stop: () => stopOrReport(),
  openLogs: () => invoke("open_logs"),
  openAdmin: () => invoke("open_admin"),
  copyToken: async () => {
    await navigator.clipboard.writeText($("[data-token-value]").textContent);
    $("[data-action=copyToken]").textContent = T.copied;
    setTimeout(() => { $("[data-action=copyToken]").textContent = T.copy; }, 1500);
    return false;
  }
};

function wire() {
  for (const button of $$("[data-action]")) {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      let changed;
      try {
        changed = await busy(() => ACTIONS[button.dataset.action]());
      } catch (error) {
        alert(String(error));
      }
      if (changed !== false) await refresh();
    });
  }
  $("[data-form=join]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const addr = form.addr.value.trim();
    const code = form.code.value.trim();
    // 코드는 화면에 남기지 않는다(REQ-2).
    form.code.value = "";
    let result = await busy(() => invoke("join", { addr, code, replace: current && current.screen.replacing === true }));
    // 읽을 수 없는 예전 등록 정보가 있으면 바꾸어 등록할지 묻는다. 묻지 않으면 이 화면에서 빠져나갈 길이 없다.
    if (!result.ok && result.category === "exists" && confirm(T.replaceConfirm)) {
      result = await busy(() => invoke("join", { addr, code, replace: true }));
    }
    if (result.ok) {
      showResult("[data-join-result]", true, T.joined(result.clientId, result.server));
      await invoke("set_rejoin", { on: false });
      await refresh();
    } else {
      const text = T.joinFailed[result.category] || T.joinFailed.unknown;
      showResult("[data-join-result]", false, result.category === "unknown" ? `${text} ${result.message}` : text);
    }
  });
  $("[data-form=server]").addEventListener("submit", (event) => {
    event.preventDefault();
    void startServer(event.target, false);
  });
  $("[data-autostart]").addEventListener("change", async (event) => {
    const result = await invoke("set_autostart", { on: event.target.checked });
    if (!result.ok) alert(result.message);
    await refresh();
  });
  // 트레이의 끝내기(REQ-8): 실행 중이면 멈출지 남길지 묻는다.
  window.__TAURI__.event.listen("confirm-quit", async () => {
    const choice = await ask("quit");
    if (choice === "stop" || choice === "keep") await invoke("quit", { stopDaemon: choice === "stop" });
  });
  scheduleRefresh();
}

function scheduleRefresh() {
  setTimeout(async () => {
    try {
      if (document.visibilityState === "visible") await refresh();
    } catch (error) {
      // 한 번 실패해도 다음 갱신은 계속한다.
    }
    scheduleRefresh();
  }, POLL_MS);
}

translate();
wire();
refresh();
