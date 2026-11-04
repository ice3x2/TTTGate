//! TTTGate Windows 런처(#322). 창과 트레이만 맡고, 터널링은 같은 bin 폴더의 CLI 가 한다.
//! 이 파일은 Tauri 와 판단 모듈(cli·view·settings)을 잇는다. 판단은 각 모듈의 단위 테스트가 다룬다.

pub mod autostart;
pub mod cli;
pub mod paths;
pub mod runner;
pub mod settings;
pub mod view;

use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

use cli::{DaemonStatus, JoinOutcome, ServerOptions};
use paths::Paths;
use runner::CliOutput;
use settings::{Mode, Settings};

const MAIN_WINDOW: &str = "main";

struct AppState {
    paths: Paths,
    exe: PathBuf,
    rejoin: AtomicBool,
    /// 마지막으로 본 실행 여부. 창을 닫을 때 숨길지 끝낼지 정한다(REQ-8).
    running: AtomicBool,
}

impl AppState {
    fn cli(&self) -> Option<PathBuf> {
        cli::find_cli(&self.paths.bin_dir, std::env::consts::ARCH)
    }

    fn run(&self, args: &[String]) -> CliOutput {
        match self.cli() {
            Some(cli) => runner::run(&cli, args, &self.paths.bin_dir),
            None => CliOutput { code: None, stdout: String::new(), stderr: "TTTGate CLI not found next to the launcher".into() },
        }
    }

    fn status(&self) -> Option<DaemonStatus> {
        let status = cli::parse_status(&self.run(&cli::status_args()).stdout);
        self.running.store(status.as_ref().map(|s| s.running).unwrap_or(false), Ordering::SeqCst);
        status
    }

    fn settings(&self) -> Settings {
        settings::load(&self.paths.config_dir)
    }

    fn save_settings(&self, settings: &Settings) -> Result<(), String> {
        settings::save(&self.paths.config_dir, settings).map_err(|e| e.to_string())
    }
}

/// 명령이 함께 쓰는 상태. CLI 를 부르는 일은 작업 스레드에서 하므로 Arc 로 나눈다.
type Shared = Arc<AppState>;

/// CLI 를 부르는 일은 수 초 걸릴 수 있다. 창과 트레이가 멈추지 않게 작업 스레드에서 한다.
async fn blocking<T: Send + 'static>(state: &State<'_, Shared>, work: impl FnOnce(&AppState) -> T + Send + 'static) -> Result<T, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || work(&shared)).await.map_err(|error| error.to_string())
}

/// 트레이 메뉴의 일도 메인 스레드를 막지 않게 따로 돈다.
fn in_background(app: &AppHandle, work: impl FnOnce(&AppHandle, &AppState) + Send + 'static) {
    let app = app.clone();
    std::thread::spawn(move || {
        let shared = app.state::<Shared>().inner().clone();
        work(&app, &shared);
    });
}

/// 시스템 폴더의 실행 파일. 이름만 주면 런처 폴더(bin)를 먼저 찾으므로 같은 이름의 파일이 대신 실행될 수 있다.
fn system_tool(name: &str) -> PathBuf {
    let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    if name == "explorer.exe" { root.join(name) } else { root.join("System32").join(name) }
}

fn stopped_status() -> DaemonStatus {
    DaemonStatus { version: String::new(), running: false, mode: None, pid: None, daemon: false, client: None, server: None }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadView {
    screen: view::Screen,
    launcher_version: String,
    cli_version: String,
    version_mismatch: bool,
    cli_missing: bool,
    settings: Settings,
    /// 서버를 처음 띄웠을 때의 부트스트랩 토큰(REQ-6). 그 밖에는 없다.
    bootstrap_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionResult {
    ok: bool,
    needs_remote_consent: bool,
    message: String,
}

impl ActionResult {
    fn from(output: &CliOutput) -> Self {
        ActionResult { ok: output.ok(), needs_remote_consent: false, message: if output.ok() { String::new() } else { output.error_message() } }
    }

    fn failed(message: String) -> Self {
        ActionResult { ok: false, needs_remote_consent: false, message }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JoinResult {
    ok: bool,
    client_id: Option<String>,
    server: Option<String>,
    category: Option<String>,
    message: Option<String>,
}

fn build_view(state: &AppState, launcher_version: String) -> LoadView {
    let settings = state.settings();
    let cli_missing = state.cli().is_none();
    let status = if cli_missing { None } else { state.status() };
    let status = status.unwrap_or_else(stopped_status);
    // 등록 확인(REQ-2a)은 클라이언트 모드이고 멈춰 있을 때만 한다. 비밀값은 CLI 가 가려서 출력한다.
    let registration = if !cli_missing && !status.running && settings.mode == Some(Mode::Client) {
        cli::parse_registration(&state.run(&cli::registration_args()).stdout)
    } else {
        None
    };
    let rejoin = state.rejoin.load(Ordering::SeqCst);
    let screen = view::screen(&view::ViewInput { mode: settings.mode, status: &status, registration: registration.as_ref(), rejoin_requested: rejoin });
    let bootstrap_token = status.server.as_ref()
        .filter(|server| server.bootstrap_required)
        .and_then(|server| server.bootstrap_token_file.as_ref())
        .and_then(|file| std::fs::read_to_string(file).ok())
        .map(|token| token.trim().to_string());
    LoadView {
        version_mismatch: view::version_mismatch(&launcher_version, &status.version),
        cli_version: status.version,
        launcher_version,
        cli_missing,
        settings,
        screen,
        bootstrap_token,
    }
}

#[tauri::command]
async fn load_view(app: AppHandle, state: State<'_, Shared>) -> Result<LoadView, String> {
    let launcher_version = app.package_info().version.to_string();
    blocking(&state, move |state| build_view(state, launcher_version)).await
}

#[tauri::command]
fn choose_mode(state: State<Shared>, mode: Option<Mode>) -> Result<(), String> {
    let mut settings = state.settings();
    settings.mode = mode;
    state.rejoin.store(false, Ordering::SeqCst);
    state.save_settings(&settings)
}

#[tauri::command]
fn set_rejoin(state: State<Shared>, on: bool) {
    state.rejoin.store(on, Ordering::SeqCst);
}

#[tauri::command]
async fn join(state: State<'_, Shared>, addr: String, code: String, replace: bool) -> Result<JoinResult, String> {
    blocking(&state, move |state| join_with(state, &addr, &code, replace)).await
}

fn join_with(state: &AppState, addr: &str, code: &str, replace: bool) -> JoinResult {
    // 코드는 표준 입력으로만 넘기고 어디에도 기록하지 않는다(REQ-2).
    let output = match state.cli() {
        Some(cli) => runner::run_with_input(&cli, &cli::join_args(addr, replace), &state.paths.bin_dir, &format!("{}\n", code)),
        None => CliOutput { code: None, stdout: String::new(), stderr: "TTTGate CLI not found next to the launcher".into() },
    };
    match cli::parse_join(&output.stdout, &output.stderr) {
        JoinOutcome::Joined { client_id, server } =>
            JoinResult { ok: true, client_id: Some(client_id), server: Some(server), category: None, message: None },
        JoinOutcome::Failed { category, message } =>
            JoinResult { ok: false, client_id: None, server: None, category: Some(category), message: Some(message) },
    }
}

fn start_daemon(state: &AppState) -> ActionResult {
    let settings = state.settings();
    let args = match settings.mode {
        Some(Mode::Client) => cli::client_daemon_args(),
        Some(Mode::Server) => cli::server_daemon_args(settings.allow_remote_admin),
        None => return ActionResult::failed("choose a mode first".into()),
    };
    let result = ActionResult::from(&state.run(&args));
    state.status();
    result
}

#[tauri::command]
async fn start_client(state: State<'_, Shared>) -> Result<ActionResult, String> {
    blocking(&state, start_daemon).await
}

#[tauri::command]
async fn start_server(state: State<'_, Shared>, options: ServerOptions, allow_remote: bool) -> Result<ActionResult, String> {
    blocking(&state, move |state| save_and_start_server(state, &options, allow_remote)).await
}

fn save_and_start_server(state: &AppState, options: &ServerOptions, allow_remote: bool) -> ActionResult {
    let saved = state.run(&cli::server_save_args(&options, allow_remote));
    if saved.code == Some(cli::REMOTE_CONSENT_EXIT_CODE) {
        return ActionResult { ok: false, needs_remote_consent: true, message: saved.error_message() };
    }
    if !saved.ok() {
        return ActionResult::from(&saved);
    }
    let mut settings = state.settings();
    settings.allow_remote_admin = allow_remote;
    if let Err(message) = state.save_settings(&settings) {
        return ActionResult::failed(message);
    }
    start_daemon(state)
}

fn stop(state: &AppState) -> ActionResult {
    let result = ActionResult::from(&state.run(&cli::stop_args()));
    // 창을 닫을 때 숨길지 끝낼지를 바로 맞추도록 실행 여부를 새로 읽는다.
    state.status();
    result
}

#[tauri::command]
async fn stop_daemon(state: State<'_, Shared>) -> Result<ActionResult, String> {
    blocking(&state, stop).await
}

fn open_admin_url(state: &AppState) {
    if let Some(url) = state.status().and_then(|s| s.server).map(|s| s.admin_url) {
        if url.starts_with("https://") || url.starts_with("http://") {
            open_with_shell(&url);
        }
    }
}

#[tauri::command]
async fn open_admin(state: State<'_, Shared>) -> Result<(), String> {
    blocking(&state, open_admin_url).await
}

fn open_logs_folder(state: &AppState) {
    let _ = std::fs::create_dir_all(&state.paths.logs_dir);
    let _ = std::process::Command::new(system_tool("explorer.exe")).arg(&state.paths.logs_dir).spawn();
}

#[tauri::command]
fn open_logs(state: State<Shared>) {
    open_logs_folder(&state);
}

/// 기본 브라우저로 연다. 런처 안에서는 외부 페이지를 열지 않는다(NFR-4).
fn open_with_shell(url: &str) {
    let _ = std::process::Command::new(system_tool("rundll32.exe")).args(["url.dll,FileProtocolHandler", url]).spawn();
}

#[tauri::command]
async fn set_autostart(state: State<'_, Shared>, on: bool) -> Result<ActionResult, String> {
    blocking(&state, move |state| apply_autostart(state, on)).await
}

fn apply_autostart(state: &AppState, on: bool) -> ActionResult {
    let output = runner::run(&system_tool("reg.exe"), &autostart::reg_args(&state.exe, on), &state.paths.bin_dir);
    // 끄려는데 값이 이미 없으면 reg delete 가 실패한다. 그때도 끈 상태다.
    if !output.ok() && on {
        return ActionResult::from(&output);
    }
    let mut settings = state.settings();
    settings.autostart = on;
    match state.save_settings(&settings) {
        Ok(()) => ActionResult { ok: true, needs_remote_consent: false, message: String::new() },
        Err(message) => ActionResult::failed(message),
    }
}

#[tauri::command]
async fn quit(app: AppHandle, state: State<'_, Shared>, stop_daemon: bool) -> Result<(), String> {
    if stop_daemon {
        blocking(&state, stop).await?;
    }
    app.exit(0);
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 끝내기(REQ-8): 실행 중이면 창에서 멈출지 남길지 묻고, 아니면 바로 끝낸다.
fn request_quit(app: &AppHandle, state: &AppState) {
    if state.status().map(|s| s.running).unwrap_or(false) {
        show_main_window(app);
        let _ = app.emit("confirm-quit", ());
    } else {
        app.exit(0);
    }
}

/// 창 밖(트레이·자동 시작)에서 띄우지 못했으면 창을 보여 사용자가 알게 한다.
fn report_start(app: &AppHandle, result: ActionResult) {
    if !result.ok {
        show_main_window(app);
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let korean = is_korean();
    let label = |ko: &str, en: &str| if korean { ko.to_string() } else { en.to_string() };
    let open = MenuItem::with_id(app, "open", label("창 열기", "Open"), true, None::<&str>)?;
    let admin = MenuItem::with_id(app, "admin", label("관리 화면 열기", "Open admin console"), true, None::<&str>)?;
    let stop_item = MenuItem::with_id(app, "stop", label("멈추기", "Stop"), true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", label("다시 시작", "Restart"), true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", label("로그 폴더 열기", "Open logs folder"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", label("끝내기", "Quit"), true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &admin, &separator, &stop_item, &restart, &logs, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut builder = TrayIconBuilder::with_id("tray").menu(&menu).show_menu_on_left_click(false).tooltip("TTTGate");
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "open" => show_main_window(app),
                "admin" => in_background(app, |_, state| open_admin_url(state)),
                "stop" => in_background(app, |_, state| { stop(state); }),
                "restart" => in_background(app, |app, state| {
                    stop(state);
                    report_start(app, start_daemon(state));
                }),
                "logs" => in_background(app, |_, state| open_logs_folder(state)),
                "quit" => in_background(app, request_quit),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Windows 표시 언어가 한국어인지(NFR-5). 창 문구는 웹뷰가 같은 기준(navigator.language)으로 고른다.
fn is_korean() -> bool {
    #[cfg(windows)]
    {
        extern "system" {
            fn GetUserDefaultUILanguage() -> u16;
        }
        // LANG_KOREAN = 0x12 (주 언어 ID 는 하위 10비트).
        unsafe { GetUserDefaultUILanguage() & 0x3ff == 0x12 }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// WebView2 가 없으면 창을 만들 수 없다. 설치 안내를 띄우고 끝낸다(NFR-2).
fn webview_available() -> bool {
    if tauri::webview_version().is_ok() {
        return true;
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
        let (title, body) = if is_korean() {
            ("TTTGate", "이 PC 에 Microsoft Edge WebView2 런타임이 없습니다.\n\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703 에서 설치한 뒤 다시 실행하세요.\n명령줄(TTTGate-win-x64.exe)은 WebView2 없이도 쓸 수 있습니다.")
        } else {
            ("TTTGate", "Microsoft Edge WebView2 Runtime is not installed on this PC.\n\nInstall it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start again.\nThe command line (TTTGate-win-x64.exe) works without WebView2.")
        };
        let wide = |text: &str| text.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        unsafe { MessageBoxW(std::ptr::null_mut(), wide(body).as_ptr(), wide(title).as_ptr(), MB_OK | MB_ICONWARNING) };
    }
    false
}

pub fn run() {
    if !webview_available() {
        return;
    }
    let exe = std::env::current_exe().expect("the launcher path");
    let paths = paths::from_exe(&exe);
    let autostarted = std::env::args().any(|arg| arg == autostart::AUTOSTART_ARG);
    tauri::Builder::default()
        // 두 번째 실행은 떠 있는 창을 앞으로 가져온다(REQ-9).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .manage::<Shared>(Arc::new(AppState { paths, exe, rejoin: AtomicBool::new(false), running: AtomicBool::new(false) }))
        .invoke_handler(tauri::generate_handler![load_view, choose_mode, set_rejoin, join, start_client, start_server,
            stop_daemon, open_admin, open_logs, set_autostart, quit])
        .setup(move |app| {
            build_tray(app.handle())?;
            if autostarted {
                // 로그인 때는 창 없이 트레이로 뜨고, 고른 모드의 데몬이 멈춰 있으면 띄운다(REQ-12).
                if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                    let _ = window.hide();
                }
                in_background(app.handle(), |app, state| {
                    if !state.status().map(|s| s.running).unwrap_or(true) {
                        report_start(app, start_daemon(state));
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 닫기는 데몬이 도는 동안 창만 숨기고 트레이에 남는다(REQ-8).
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<Shared>().running.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("the launcher could not start");
}
