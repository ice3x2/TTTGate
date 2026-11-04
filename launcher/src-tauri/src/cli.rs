//! TTTGate CLI 를 부르는 인자와 그 출력의 해석(#322).
//! 런처는 창과 트레이만 맡는다. 판단과 파일 형식은 CLI 가 안다.

use serde::Deserialize;
use std::path::{Path, PathBuf};

/// 런처와 같은 폴더에서 찾을 CLI 실행 파일. 이 PC 의 아키텍처에 맞는 것을 먼저 본다.
pub fn find_cli(bin_dir: &Path, native_arch: &str) -> Option<PathBuf> {
    let names = if native_arch == "aarch64" {
        ["TTTGate-win-arm64.exe", "TTTGate-win-x64.exe"]
    } else {
        ["TTTGate-win-x64.exe", "TTTGate-win-arm64.exe"]
    };
    names.iter().map(|name| bin_dir.join(name)).find(|path| path.is_file())
}

/// CLI 는 결과를 마지막 줄에 JSON 으로 쓴다. 그 앞의 줄(경고 등)은 보지 않는다.
fn last_json_line(stdout: &str) -> Option<&str> {
    stdout.lines().map(str::trim).filter(|line| !line.is_empty()).last().filter(|line| line.starts_with('{'))
}

/// 실행 중인 TTTGate(`TTTGate status --json`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct DaemonStatus {
    pub version: String,
    pub running: bool,
    pub mode: Option<String>,
    pub pid: Option<u32>,
    pub daemon: bool,
    pub client: Option<ClientStatus>,
    pub server: Option<ServerStatus>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ClientStatus {
    pub state: String,
    pub since: f64,
    pub failures: u32,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub admin_url: String,
    pub bootstrap_required: bool,
    pub bootstrap_token_file: Option<String>,
}

pub fn parse_status(stdout: &str) -> Option<DaemonStatus> {
    serde_json::from_str(last_json_line(stdout)?).ok()
}

/// `client join --json` 의 결과.
#[derive(Debug, Clone, PartialEq)]
pub enum JoinOutcome {
    Joined { client_id: String, server: String },
    Failed { category: String, message: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinJson {
    ok: bool,
    client_id: Option<String>,
    server: Option<String>,
    category: Option<String>,
    message: Option<String>,
}

/// JSON 결과가 없으면 stderr(없으면 stdout)를 문장으로 돌려준다. 사용자가 원인을 알 수 있어야 한다.
pub fn parse_join(stdout: &str, stderr: &str) -> JoinOutcome {
    let parsed: Option<JoinJson> = last_json_line(stdout).and_then(|line| serde_json::from_str(line).ok());
    match parsed {
        Some(JoinJson { ok: true, client_id: Some(client_id), server: Some(server), .. }) => JoinOutcome::Joined { client_id, server },
        Some(json) if !json.ok => JoinOutcome::Failed {
            category: json.category.unwrap_or_else(|| "unknown".into()),
            message: json.message.unwrap_or_default(),
        },
        _ => {
            let message = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
            JoinOutcome::Failed { category: "unknown".into(), message: message.to_string() }
        }
    }
}

/// 이 PC 의 실제 CPU 아키텍처. x64 런처가 arm64 Windows 에서 에뮬레이션으로 돌아도 aarch64 를 돌려준다.
/// (`std::env::consts::ARCH` 는 런처를 빌드한 아키텍처라 에뮬레이션 중에는 x86_64 다.)
#[cfg(windows)]
pub fn native_arch() -> &'static str {
    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn IsWow64Process2(process: isize, process_machine: *mut u16, native_machine: *mut u16) -> i32;
    }
    const IMAGE_FILE_MACHINE_ARM64: u16 = 0xAA64;
    const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;
    let (mut process_machine, mut native_machine) = (0u16, 0u16);
    // 조회가 실패하면 빌드 아키텍처를 쓴다. 이 함수는 Windows 10 1709 부터 있으므로 그보다 오래된 Windows 에서는
    // 런처가 뜨지 않는다(README 의 최소 지원 버전).
    let ok = unsafe { IsWow64Process2(GetCurrentProcess(), &mut process_machine, &mut native_machine) } != 0;
    match (ok, native_machine) {
        (true, IMAGE_FILE_MACHINE_ARM64) => "aarch64",
        (true, IMAGE_FILE_MACHINE_AMD64) => "x86_64",
        _ => std::env::consts::ARCH,
    }
}

#[cfg(not(windows))]
pub fn native_arch() -> &'static str {
    std::env::consts::ARCH
}

/// `client config show` 에서 읽은 등록 정보. 비밀값은 CLI 가 `(hidden)` 으로 가려 출력한다.
#[derive(Debug, Clone, PartialEq)]
pub struct Registration {
    pub client_id: String,
    pub server: String,
}

/// `config show` 의 한 줄: `이름: 값   (출처)`.
fn shown_value<'a>(stdout: &'a str, key: &str) -> Option<&'a str> {
    stdout.lines().find_map(|line| {
        let rest = line.trim().strip_prefix(key)?.strip_prefix(": ")?;
        let value = match rest.rfind("  (") {
            Some(index) if rest.ends_with(')') => &rest[..index],
            _ => rest,
        };
        Some(value.trim())
    })
}

pub fn parse_registration(stdout: &str) -> Option<Registration> {
    let client_id = shown_value(stdout, "clientId").filter(|id| !id.is_empty())?;
    shown_value(stdout, "clientSecret").filter(|secret| *secret == "(hidden)")?;
    let host = shown_value(stdout, "host")?;
    let server = match shown_value(stdout, "port") {
        // IPv6 주소는 포트와 헷갈리지 않게 대괄호로 감싼다.
        Some(port) if host.contains(':') => format!("[{}]:{}", host, port),
        Some(port) => format!("{}:{}", host, port),
        None => host.to_string(),
    };
    Some(Registration { client_id: client_id.to_string(), server })
}

/// 서버 모드에서 런처가 받는 옵션(REQ-4). 비어 있는 값은 server.yaml 의 값을 그대로 둔다.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerOptions {
    /// 포트는 글자 그대로 넘기고 검사는 CLI 가 한다(REQ-4). 화면이 숫자로 바꾸면 틀린 값이 조용히 사라진다.
    pub admin_port: Option<String>,
    pub admin_bind_host: Option<String>,
    pub admin_allowed_origins: Option<Vec<String>>,
    pub control_port: Option<String>,
    pub control_tls: Option<bool>,
    pub control_protocol_mode: Option<String>,
}

const ALLOW_REMOTE_FLAG: &str = "-allowLegacyAdminRemote";
/// `server config save` 가 관리 화면을 다른 PC 에 열려면 사용자 확인이 필요하다고 알리는 종료 코드(REQ-5).
pub const REMOTE_CONSENT_EXIT_CODE: i32 = 77;

fn args(items: &[&str]) -> Vec<String> {
    items.iter().map(|item| item.to_string()).collect()
}

pub fn status_args() -> Vec<String> { args(&["status", "--json"]) }
pub fn version_args() -> Vec<String> { args(&["--version"]) }

/// `TTTGate v2.0.1 (빌드)` 에서 버전을 읽는다. status 가 없는 옛 CLI 의 버전을 알 때 쓴다(NFR-6).
pub fn parse_version(stdout: &str) -> Option<String> {
    let rest = stdout.trim().strip_prefix("TTTGate v")?;
    let version = rest.split_whitespace().next()?;
    Some(version.to_string())
}
pub fn registration_args() -> Vec<String> { args(&["client", "config", "show"]) }

/// 등록 코드는 표준 입력으로 넘긴다(`runner::run_with_input`). 명령줄은 다른 사용자와 감사 로그가 볼 수 있다(REQ-2).
pub fn join_args(addr: &str, replace: bool) -> Vec<String> {
    let mut list = args(&["client", "join", addr, "--code-stdin", "--json"]);
    if replace {
        list.push("--force".into());
    }
    list
}

pub fn client_daemon_args() -> Vec<String> { args(&["client", "-daemon"]) }

pub fn server_save_args(options: &ServerOptions, allow_remote: bool) -> Vec<String> {
    let mut list = args(&["server", "config", "save"]);
    let mut push = |name: &str, value: String| { list.push(format!("-{}", name)); list.push(value); };
    if let Some(port) = &options.admin_port { push("adminPort", port.clone()); }
    if let Some(host) = &options.admin_bind_host { push("adminBindHost", host.clone()); }
    // CLI 는 빈 값을 받지 않는다. 빈 목록은 넘기지 않아 지금 값을 그대로 둔다.
    if let Some(origins) = options.admin_allowed_origins.as_ref().filter(|origins| !origins.is_empty()) {
        push("adminAllowedOrigins", origins.join(","));
    }
    if let Some(port) = &options.control_port { push("controlPort", port.clone()); }
    if let Some(tls) = options.control_tls { push("controlTls", tls.to_string()); }
    if let Some(mode) = &options.control_protocol_mode { push("controlProtocolMode", mode.clone()); }
    if allow_remote {
        list.push(ALLOW_REMOTE_FLAG.into());
    }
    list
}

pub fn server_daemon_args(allow_remote: bool) -> Vec<String> {
    let mut list = args(&["server", "-daemon"]);
    if allow_remote {
        list.push(ALLOW_REMOTE_FLAG.into());
    }
    list
}

pub fn stop_args() -> Vec<String> { args(&["stop"]) }

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tttgate-launcher-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn find_cli_prefers_the_native_architecture_and_falls_back_to_the_other() {
        let dir = temp_dir("find-cli");
        assert_eq!(find_cli(&dir, "x86_64"), None);
        fs::write(dir.join("TTTGate-win-arm64.exe"), b"x").unwrap();
        assert_eq!(find_cli(&dir, "x86_64"), Some(dir.join("TTTGate-win-arm64.exe")));
        fs::write(dir.join("TTTGate-win-x64.exe"), b"x").unwrap();
        assert_eq!(find_cli(&dir, "x86_64"), Some(dir.join("TTTGate-win-x64.exe")));
        assert_eq!(find_cli(&dir, "aarch64"), Some(dir.join("TTTGate-win-arm64.exe")));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(all(windows, target_arch = "x86_64"))]
    #[test]
    fn the_native_architecture_is_read_from_the_os() {
        // 이 시험 PC 는 x64 다. arm64 PC 에서 에뮬레이션으로 돌면 aarch64 를 돌려줘야 한다.
        assert_eq!(native_arch(), "x86_64");
    }

    /// launcher/contract 의 파일은 CLI 가 실제로 내는 JSON 이다(test/unit/launcher-contract.test.ts 가 지킨다).
    #[test]
    fn the_cli_contract_files_are_read() {
        let client = parse_status(include_str!("../../contract/status-client.json")).expect("status-client.json");
        assert_eq!(client.mode.as_deref(), Some("client"));
        assert_eq!(client.client.as_ref().map(|c| (c.state.as_str(), c.failures)), Some(("reconnecting", 3)));
        let server = parse_status(include_str!("../../contract/status-server.json")).expect("status-server.json");
        assert!(server.server.expect("server").bootstrap_required);
        assert_eq!(parse_join(include_str!("../../contract/join-ok.json"), ""),
            JoinOutcome::Joined { client_id: "edge".into(), server: "gw.example:9126".into() });
        assert_eq!(parse_registration(include_str!("../../contract/config-show.txt")),
            Some(Registration { client_id: "edge".into(), server: "gw.example:9126".into() }));
        assert_eq!(parse_join(include_str!("../../contract/join-failed.json"), ""),
            JoinOutcome::Failed { category: "rejected".into(), message: "enrollment failed: m".into() });
    }

    #[test]
    fn status_json_is_parsed() {
        let line = r#"{"version":"2.1.0","running":true,"mode":"client","pid":12,"daemon":true,"client":{"state":"reconnecting","since":5,"failures":3},"server":null}"#;
        let status = parse_status(&format!("{}\n", line)).unwrap();
        assert_eq!(status.mode.as_deref(), Some("client"));
        assert_eq!(status.client.unwrap().failures, 3);
        let server = r#"{"version":"2.1.0","running":true,"mode":"server","pid":1,"daemon":false,"client":null,"server":{"adminUrl":"https://127.0.0.1:9300/","bootstrapRequired":true,"bootstrapTokenFile":"C:\\t\\config\\.bootstrap-token"}}"#;
        assert!(parse_status(server).unwrap().server.unwrap().bootstrap_required);
        assert_eq!(parse_status("TTTGate v2 (dev)"), None);
        assert_eq!(parse_status(""), None);
    }

    #[test]
    fn join_json_is_parsed_and_anything_else_is_a_failure() {
        assert_eq!(parse_join(r#"{"ok":true,"clientId":"edge","server":"gw:9126"}"#, ""),
            JoinOutcome::Joined { client_id: "edge".into(), server: "gw:9126".into() });
        assert_eq!(parse_join("{\"ok\":false,\"category\":\"rejected\",\"message\":\"m\"}\n", "warning: x"),
            JoinOutcome::Failed { category: "rejected".into(), message: "m".into() });
        assert_eq!(parse_join("boom", ""), JoinOutcome::Failed { category: "unknown".into(), message: "boom".into() });
        // JSON 이 없으면(예: 옛 CLI 가 옵션을 모름) 사용자가 원인을 알도록 stderr 를 보인다.
        assert_eq!(parse_join("", "TTTGate: unknown option '--code-stdin'\n"),
            JoinOutcome::Failed { category: "unknown".into(), message: "TTTGate: unknown option '--code-stdin'".into() });
    }

    #[test]
    fn registration_needs_a_client_id_and_a_hidden_secret() {
        let shown = "host: gw.example       (file)\nport: 9126              (file)\ntls: true               (file)\nclientId: edge          (file)\nclientSecret: (hidden)  (file)\nname: edge              (file)\n";
        assert_eq!(parse_registration(shown), Some(Registration { client_id: "edge".into(), server: "gw.example:9126".into() }));
        assert_eq!(parse_registration("host: gw  (file)\nclientId: edge  (file)\n"), None);
        assert_eq!(parse_registration("host: gw  (file)\nclientSecret: (hidden)  (env)\n"), None);
        assert_eq!(parse_registration(""), None);
        let ipv6 = "host: ::1  (file)\nport: 9126  (file)\nclientId: edge  (file)\nclientSecret: (hidden)  (file)\n";
        assert_eq!(parse_registration(ipv6).unwrap().server, "[::1]:9126");
    }

    #[test]
    fn the_version_line_is_parsed() {
        assert_eq!(version_args(), strings(&["--version"]));
        assert_eq!(parse_version("TTTGate v2.0.1 (20261104)\n"), Some("2.0.1".to_string()));
        assert_eq!(parse_version("TTTGate v1.0.11b (dev)"), Some("1.0.11b".to_string()));
        assert_eq!(parse_version("something else"), None);
    }

    #[test]
    fn command_lines_match_the_cli() {
        assert_eq!(status_args(), strings(&["status", "--json"]));
        assert_eq!(registration_args(), strings(&["client", "config", "show"]));
        // 코드는 표준 입력으로 넘긴다. 명령줄에 두면 프로세스 생성 감사 로그에 남는다(REQ-2).
        assert_eq!(join_args("gw:9126", false), strings(&["client", "join", "gw:9126", "--code-stdin", "--json"]));
        assert_eq!(join_args("gw", true), strings(&["client", "join", "gw", "--code-stdin", "--json", "--force"]));
        assert_eq!(client_daemon_args(), strings(&["client", "-daemon"]));
        assert_eq!(server_daemon_args(false), strings(&["server", "-daemon"]));
        assert_eq!(server_daemon_args(true), strings(&["server", "-daemon", "-allowLegacyAdminRemote"]));
        assert_eq!(stop_args(), strings(&["stop"]));
    }

    #[test]
    fn server_save_passes_only_the_given_values() {
        assert_eq!(server_save_args(&ServerOptions::default(), false), strings(&["server", "config", "save"]));
        let options = ServerOptions {
            admin_port: Some("9300".into()), admin_bind_host: Some("0.0.0.0".into()),
            admin_allowed_origins: Some(vec!["https://a:9300".into(), "https://b".into()]),
            control_port: Some("9126".into()), control_tls: Some(false), control_protocol_mode: Some("mixed".into()),
        };
        assert_eq!(server_save_args(&options, true), strings(&["server", "config", "save", "-adminPort", "9300", "-adminBindHost", "0.0.0.0",
            "-adminAllowedOrigins", "https://a:9300,https://b", "-controlPort", "9126", "-controlTls", "false",
            "-controlProtocolMode", "mixed", "-allowLegacyAdminRemote"]));
        // CLI 는 빈 값을 받지 않는다. 빈 목록은 지금 값을 그대로 둔다(목록 지우기는 관리 화면에서 한다).
        let empty_origins = ServerOptions { admin_allowed_origins: Some(vec![]), ..Default::default() };
        assert_eq!(server_save_args(&empty_origins, false), strings(&["server", "config", "save"]));
        // 틀린 포트도 그대로 넘겨 CLI 가 거부하게 한다.
        let wrong = ServerOptions { admin_port: Some("70000".into()), control_port: Some("abc".into()), ..Default::default() };
        assert_eq!(server_save_args(&wrong, false), strings(&["server", "config", "save", "-adminPort", "70000", "-controlPort", "abc"]));
    }
}
