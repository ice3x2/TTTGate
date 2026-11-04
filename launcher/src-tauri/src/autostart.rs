//! Windows 로그인 때 자동 시작(#322 REQ-12). 관리자 권한 없이 현재 사용자의 Run 키를 쓴다(NFR-3).

use std::path::Path;

pub const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
pub const VALUE_NAME: &str = "TTTGate Launcher";
/// 자동 시작으로 뜬 런처는 창 없이 트레이로 시작한다.
pub const AUTOSTART_ARG: &str = "--autostart";

/// 값이 있는지 묻는 reg.exe 인자. 종료 코드 0 이면 있다.
pub fn query_args() -> Vec<String> {
    vec!["query".into(), RUN_KEY.into(), "/v".into(), VALUE_NAME.into()]
}

/// reg.exe 에 줄 인자.
pub fn reg_args(exe: &Path, on: bool) -> Vec<String> {
    let args: Vec<String> = if on {
        let command = format!("\"{}\" {}", exe.display(), AUTOSTART_ARG);
        vec!["add".into(), RUN_KEY.into(), "/v".into(), VALUE_NAME.into(), "/t".into(), "REG_SZ".into(), "/d".into(), command, "/f".into()]
    } else {
        vec!["delete".into(), RUN_KEY.into(), "/v".into(), VALUE_NAME.into(), "/f".into()]
    };
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turning_on_writes_the_quoted_exe_with_the_autostart_argument() {
        let exe = Path::new(r"C:\Program Files\TTTGate\bin\TTTGate-launcher-win-x64.exe");
        assert_eq!(reg_args(exe, true), vec!["add", RUN_KEY, "/v", VALUE_NAME, "/t", "REG_SZ", "/d",
            r#""C:\Program Files\TTTGate\bin\TTTGate-launcher-win-x64.exe" --autostart"#, "/f"]);
    }

    #[test]
    fn the_value_is_queried_before_it_is_deleted() {
        // 값이 없어서 지우기가 실패한 것과 권한이 없어서 실패한 것을 가린다.
        assert_eq!(query_args(), vec!["query", RUN_KEY, "/v", VALUE_NAME]);
    }

    #[test]
    fn turning_off_deletes_the_value() {
        assert_eq!(reg_args(Path::new(r"C:\x.exe"), false), vec!["delete", RUN_KEY, "/v", VALUE_NAME, "/f"]);
    }
}
