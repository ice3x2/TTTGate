//! 지금 어느 화면을 보일지(#322 REQ-1·2a·2b·3·10, NFR-6). 창은 이 결과만 그린다.

use crate::cli::{DaemonStatus, Registration};
use crate::settings::Mode;
use serde::Serialize;

/// 이만큼 연속으로 연결에 실패하면 원인 후보(삭제·비밀값 변경)를 함께 보인다(REQ-2b).
pub const AUTH_HINT_FAILURES: u32 = 3;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "screen", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Screen {
    /// 처음 실행: 서버와 클라이언트 가운데 하나를 고른다.
    ChooseMode,
    /// 등록 정보가 없거나 사용자가 다시 등록을 골랐다.
    ClientJoin { replacing: bool },
    /// 등록됐고 멈춰 있다.
    ClientReady { client_id: String, server: String },
    /// 서버 옵션을 넣고 시작한다.
    ServerSetup,
    /// 실행 중. 모드는 실제로 도는 프로세스의 것이다.
    Running(RunningView),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningView {
    pub mode: Option<String>,
    pub pid: Option<u32>,
    pub daemon: bool,
    /// connected · reconnecting · connecting (클라이언트만)
    pub connection: Option<String>,
    pub failures: u32,
    pub auth_hint: bool,
    pub admin_url: Option<String>,
    pub bootstrap_required: bool,
}

pub struct ViewInput<'a> {
    pub mode: Option<Mode>,
    pub status: &'a DaemonStatus,
    pub registration: Option<&'a Registration>,
    pub rejoin_requested: bool,
}

pub fn screen(input: &ViewInput) -> Screen {
    let status = input.status;
    if status.running {
        return Screen::Running(running_view(status));
    }
    match input.mode {
        None => Screen::ChooseMode,
        Some(Mode::Server) => Screen::ServerSetup,
        Some(Mode::Client) => match input.registration {
            Some(registration) if !input.rejoin_requested => Screen::ClientReady {
                client_id: registration.client_id.clone(),
                server: registration.server.clone(),
            },
            Some(_) => Screen::ClientJoin { replacing: true },
            None => Screen::ClientJoin { replacing: false },
        },
    }
}

fn running_view(status: &DaemonStatus) -> RunningView {
    // 상태 파일은 바뀔 때만 쓰이므로 연결된 동안에도 마지막 실패 수가 남는다. 연결됐으면 실패를 보이지 않는다.
    let failures = status.client.as_ref()
        .filter(|client| client.state != "connected")
        .map(|client| client.failures)
        .unwrap_or(0);
    RunningView {
        mode: status.mode.clone(),
        pid: status.pid,
        daemon: status.daemon,
        connection: status.client.as_ref().map(|client| client.state.clone()),
        failures,
        auth_hint: failures >= AUTH_HINT_FAILURES,
        admin_url: status.server.as_ref().map(|server| server.admin_url.clone()),
        bootstrap_required: status.server.as_ref().map(|server| server.bootstrap_required).unwrap_or(false),
    }
}

/// 런처와 CLI 의 버전이 다르면 경고한다(NFR-6). 버전을 모르면(CLI 가 없음 등) 경고하지 않는다.
pub fn version_mismatch(launcher: &str, cli: &str) -> bool {
    !cli.is_empty() && launcher != cli
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::{ClientStatus, ServerStatus};

    fn stopped() -> DaemonStatus {
        DaemonStatus { version: "2.1.0".into(), running: false, mode: None, pid: None, daemon: false, client: None, server: None }
    }

    fn running_client(failures: u32, state: &str) -> DaemonStatus {
        DaemonStatus { running: true, mode: Some("client".into()), pid: Some(9), daemon: true,
            client: Some(ClientStatus { state: state.into(), since: 1.0, failures }), ..stopped() }
    }

    fn registration() -> Registration {
        Registration { client_id: "edge".into(), server: "gw:9126".into() }
    }

    fn input<'a>(mode: Option<Mode>, status: &'a DaemonStatus, registration: Option<&'a Registration>, rejoin: bool) -> ViewInput<'a> {
        ViewInput { mode, status, registration, rejoin_requested: rejoin }
    }

    #[test]
    fn ac1_no_mode_chosen_shows_the_mode_choice() {
        assert_eq!(screen(&input(None, &stopped(), None, false)), Screen::ChooseMode);
    }

    #[test]
    fn ac2a_a_registered_client_skips_the_join_screen() {
        let reg = registration();
        assert_eq!(screen(&input(Some(Mode::Client), &stopped(), Some(&reg), false)),
            Screen::ClientReady { client_id: "edge".into(), server: "gw:9126".into() });
        assert_eq!(screen(&input(Some(Mode::Client), &stopped(), None, false)), Screen::ClientJoin { replacing: false });
    }

    #[test]
    fn req2b_join_again_only_when_asked() {
        let reg = registration();
        assert_eq!(screen(&input(Some(Mode::Client), &stopped(), Some(&reg), true)), Screen::ClientJoin { replacing: true });
    }

    #[test]
    fn server_mode_shows_the_setup_when_stopped() {
        assert_eq!(screen(&input(Some(Mode::Server), &stopped(), None, false)), Screen::ServerSetup);
    }

    #[test]
    fn req10_a_running_process_wins_over_the_saved_mode() {
        let status = running_client(0, "connected");
        match screen(&input(Some(Mode::Server), &status, None, false)) {
            Screen::Running(view) => {
                assert_eq!(view.mode.as_deref(), Some("client"));
                assert_eq!(view.connection.as_deref(), Some("connected"));
                assert!(!view.auth_hint);
            }
            other => panic!("{:?}", other),
        }
        // 실행 중일 때 다시 등록을 골라도 먼저 멈춰야 하므로 실행 화면을 보인다.
        assert!(matches!(screen(&input(None, &status, None, true)), Screen::Running(_)));
    }

    #[test]
    fn req2b_repeated_failures_show_the_hint() {
        let view = |failures| match screen(&input(Some(Mode::Client), &running_client(failures, "reconnecting"), None, false)) {
            Screen::Running(view) => view,
            other => panic!("{:?}", other),
        };
        assert!(!view(AUTH_HINT_FAILURES - 1).auth_hint);
        assert!(view(AUTH_HINT_FAILURES).auth_hint);
        assert_eq!(view(AUTH_HINT_FAILURES).failures, AUTH_HINT_FAILURES);
    }

    #[test]
    fn req2b_a_recovered_connection_hides_the_hint_and_the_failure_count() {
        // 상태 파일은 바뀔 때만 쓰이므로 연결된 동안에도 마지막 실패 수가 남아 있다.
        match screen(&input(Some(Mode::Client), &running_client(AUTH_HINT_FAILURES, "connected"), None, false)) {
            Screen::Running(view) => {
                assert!(!view.auth_hint);
                assert_eq!(view.failures, 0);
            }
            other => panic!("{:?}", other),
        }
    }

    #[test]
    fn a_running_server_shows_the_admin_url_and_the_bootstrap_state() {
        let status = DaemonStatus { running: true, mode: Some("server".into()), pid: Some(3), daemon: true,
            server: Some(ServerStatus { admin_url: "https://127.0.0.1:9300/".into(), bootstrap_required: true,
                bootstrap_token_file: Some("t".into()) }), ..stopped() };
        match screen(&input(Some(Mode::Server), &status, None, false)) {
            Screen::Running(view) => {
                assert_eq!(view.admin_url.as_deref(), Some("https://127.0.0.1:9300/"));
                assert!(view.bootstrap_required);
                assert_eq!(view.connection, None);
            }
            other => panic!("{:?}", other),
        }
    }

    #[test]
    fn nfr6_version_mismatch() {
        assert!(!version_mismatch("2.1.0", "2.1.0"));
        assert!(version_mismatch("2.1.0", "2.0.1"));
        assert!(!version_mismatch("2.1.0", ""));
    }
}
