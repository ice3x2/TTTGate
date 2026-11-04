//! Windows 로그인 때 자동 시작(#322 REQ-12). 관리자 권한 없이 현재 사용자의 Run 키를 쓴다(NFR-3).

use std::path::Path;

pub const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_PREFIX: &str = "TTTGate Launcher";
/// 자동 시작으로 뜬 런처는 창 없이 트레이로 시작한다.
pub const AUTOSTART_ARG: &str = "--autostart";

/// Run 값 이름. 설치 폴더마다 다르게 해 한 PC 의 여러 설치본이 서로 덮어쓰지 않게 한다.
/// 경로는 Windows 처럼 대소문자를 무시하고 FNV-1a 로 줄인다.
pub fn value_name(exe: &Path) -> String {
    // 같은 폴더를 다른 표기(짧은 경로, subst 등)로 띄워도 같은 이름이 되도록 정규화한 경로로 만든다.
    // 정규화한 경로(\\?\ 접두어)는 이름에만 쓰고, Run 값의 명령에는 원래 경로를 쓴다.
    let key = std::fs::canonicalize(exe).unwrap_or_else(|_| exe.to_path_buf());
    let mut hash: u32 = 0x811c_9dc5;
    for byte in key.to_string_lossy().to_lowercase().bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    format!("{} ({:08x})", VALUE_PREFIX, hash)
}

/// 값이 있는지 묻는 reg.exe 인자. 종료 코드 0 이면 있다.
pub fn query_args(exe: &Path) -> Vec<String> {
    vec!["query".into(), RUN_KEY.into(), "/v".into(), value_name(exe)]
}

/// reg.exe 에 줄 인자.
pub fn reg_args(exe: &Path, on: bool) -> Vec<String> {
    let args: Vec<String> = if on {
        let command = format!("\"{}\" {}", exe.display(), AUTOSTART_ARG);
        vec!["add".into(), RUN_KEY.into(), "/v".into(), value_name(exe), "/t".into(), "REG_SZ".into(), "/d".into(), command, "/f".into()]
    } else {
        vec!["delete".into(), RUN_KEY.into(), "/v".into(), value_name(exe), "/f".into()]
    };
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = r"C:\Program Files\TTTGate\bin\TTTGate-launcher-win-x64.exe";

    #[test]
    fn each_installation_has_its_own_value_name() {
        // 한 PC 에 여러 설치본이 있어도 자동 시작 값이 서로 덮어쓰지 않는다. 대소문자는 Windows 처럼 무시한다.
        let a = value_name(Path::new(EXE));
        assert!(a.starts_with("TTTGate Launcher ("), "{}", a);
        assert_eq!(a, value_name(Path::new(&EXE.to_uppercase())));
        assert_ne!(a, value_name(Path::new(r"D:\Other\TTTGate\bin\TTTGate-launcher-win-x64.exe")));
    }

    #[test]
    fn turning_on_writes_the_quoted_exe_with_the_autostart_argument() {
        let exe = Path::new(EXE);
        assert_eq!(reg_args(exe, true), vec!["add".to_string(), RUN_KEY.into(), "/v".into(), value_name(exe), "/t".into(), "REG_SZ".into(), "/d".into(),
            format!("\"{}\" --autostart", EXE), "/f".into()]);
    }

    #[test]
    fn the_value_is_queried_before_it_is_deleted() {
        // 값이 없어서 지우기가 실패한 것과 권한이 없어서 실패한 것을 가린다.
        let exe = Path::new(EXE);
        assert_eq!(query_args(exe), vec!["query".to_string(), RUN_KEY.into(), "/v".into(), value_name(exe)]);
    }

    #[test]
    fn turning_off_deletes_the_value() {
        let exe = Path::new(EXE);
        assert_eq!(reg_args(exe, false), vec!["delete".to_string(), RUN_KEY.into(), "/v".into(), value_name(exe), "/f".into()]);
    }
}
