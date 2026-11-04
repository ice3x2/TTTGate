//! CLI 를 창 없이 실행하고 출력을 받는다.
//! `-daemon` 은 분리된 자식을 남기고 끝난다. 그 자식이 파이프를 물려받으면 읽기가 끝나지 않으므로 출력은 임시 파일로 받는다.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, PartialEq)]
pub struct CliOutput {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl CliOutput {
    pub fn ok(&self) -> bool {
        self.code == Some(0)
    }

    /// 사용자에게 보일 오류 문장. stderr 가 비면 종료 코드를 알린다.
    pub fn error_message(&self) -> String {
        let stderr = self.stderr.trim();
        if !stderr.is_empty() {
            return stderr.to_string();
        }
        match self.code {
            Some(code) => format!("TTTGate exited with code {}", code),
            None => "TTTGate did not finish".to_string(),
        }
    }
}

pub fn run(cli: &Path, args: &[String], work_dir: &Path) -> CliOutput {
    run_inner(cli, args, work_dir, None)
}

/// 표준 입력으로 `input` 을 넘긴다. 등록 코드처럼 명령줄에 두면 안 되는 값을 넘길 때 쓴다.
pub fn run_with_input(cli: &Path, args: &[String], work_dir: &Path, input: &str) -> CliOutput {
    run_inner(cli, args, work_dir, Some(input))
}

/// CLI 출력을 받는 폴더. `-daemon` 은 분리된 자식에게 출력 파일 핸들을 물려주므로, 그 파일은 데몬이 끝날 때까지 지워지지 않는다.
/// 그래서 런처 전용 폴더에 두고 런처가 시작할 때 남은 것을 지운다(`remove_old_outputs`).
pub fn output_dir() -> PathBuf {
    std::env::temp_dir().join("tttgate-launcher")
}

/// 앞선 실행이 남긴 출력 파일을 지운다. 아직 데몬이 잡고 있는 파일은 지워지지 않으므로 그대로 둔다.
/// 런처가 다른 명령을 부르기 전에 한 번만 부른다(돌고 있는 명령의 파일을 지우지 않도록).
pub fn remove_old_outputs(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let _ = fs::remove_file(entry.path());
    }
}

/// `attempts` 번 모두 `check` 가 참이어야 참이다. 거짓을 보면 바로 끝낸다.
pub fn holds_for(attempts: u32, interval: std::time::Duration, mut check: impl FnMut() -> bool) -> bool {
    for attempt in 0..attempts {
        if !check() {
            return false;
        }
        if attempt + 1 < attempts {
            std::thread::sleep(interval);
        }
    }
    true
}

/// `check` 가 참이 될 때까지 `interval` 간격으로 최대 `attempts` 번 본다.
pub fn poll_until(attempts: u32, interval: std::time::Duration, mut check: impl FnMut() -> bool) -> bool {
    for attempt in 0..attempts {
        if check() {
            return true;
        }
        if attempt + 1 < attempts {
            std::thread::sleep(interval);
        }
    }
    false
}

/// 같은 시각에 두 명령이 돌아도(화면 갱신과 트레이 동작) 출력 파일이 겹치지 않게 순번을 붙인다.
static NEXT_OUTPUT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn run_inner(cli: &Path, args: &[String], work_dir: &Path, input: Option<&str>) -> CliOutput {
    let sequence = NEXT_OUTPUT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let unique = format!("{}-{}", std::process::id(), sequence);
    let dir = output_dir();
    let _ = fs::create_dir_all(&dir);
    let out_file = dir.join(format!("{}.out", unique));
    let err_file = dir.join(format!("{}.err", unique));
    let result = spawn_and_wait(cli, args, work_dir, &out_file, &err_file, input);
    let output = match result {
        Ok(code) => CliOutput {
            code,
            stdout: fs::read_to_string(&out_file).unwrap_or_default(),
            stderr: fs::read_to_string(&err_file).unwrap_or_default(),
        },
        Err(error) => CliOutput { code: None, stdout: String::new(), stderr: error.to_string() },
    };
    let _ = fs::remove_file(&out_file);
    let _ = fs::remove_file(&err_file);
    output
}

fn spawn_and_wait(cli: &Path, args: &[String], work_dir: &Path, out_file: &Path, err_file: &Path, input: Option<&str>)
    -> std::io::Result<Option<i32>> {
    let mut command = Command::new(cli);
    command.args(args).current_dir(work_dir)
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::from(fs::File::create(out_file)?))
        .stderr(Stdio::from(fs::File::create(err_file)?));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn()?;
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        use std::io::Write;
        // 쓰고 나서 stdin 을 닫아야 자식이 입력의 끝을 안다(이 블록을 벗어나며 닫힌다).
        // 자식이 먼저 끝나면(예: 옛 CLI 가 옵션을 거부) 쓰기가 실패한다. 그때도 기다려 자식의 오류를 보인다.
        let _ = stdin.write_all(text.as_bytes());
    }
    Ok(child.wait()?.code())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outputs_live_in_their_own_folder_and_old_ones_are_removed() {
        let dir = std::env::temp_dir().join(format!("tttgate-runner-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("left-by-a-daemon.out"), b"x").unwrap();
        fs::write(dir.join("left-by-a-daemon.err"), b"x").unwrap();
        remove_old_outputs(&dir);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        fs::remove_dir_all(&dir).unwrap();
        assert!(output_dir().ends_with("tttgate-launcher"));
    }

    #[test]
    fn poll_until_stops_at_the_first_success_or_after_the_attempts() {
        let mut calls = 0;
        assert!(poll_until(5, std::time::Duration::ZERO, || { calls += 1; calls == 3 }));
        assert_eq!(calls, 3);
        let mut never = 0;
        assert!(!poll_until(4, std::time::Duration::ZERO, || { never += 1; false }));
        assert_eq!(never, 4);
    }

    #[test]
    fn holds_for_needs_every_check_to_pass_and_stops_at_the_first_failure() {
        let mut calls = 0;
        assert!(holds_for(4, std::time::Duration::ZERO, || { calls += 1; true }));
        assert_eq!(calls, 4);
        let mut checks = 0;
        assert!(!holds_for(4, std::time::Duration::ZERO, || { checks += 1; checks < 2 }));
        assert_eq!(checks, 2);
    }

    #[test]
    fn the_error_message_prefers_stderr() {
        let output = CliOutput { code: Some(1), stdout: "x".into(), stderr: "  bad port \n".into() };
        assert_eq!(output.error_message(), "bad port");
        let silent = CliOutput { code: Some(78), stdout: String::new(), stderr: String::new() };
        assert_eq!(silent.error_message(), "TTTGate exited with code 78");
        let killed = CliOutput { code: None, stdout: String::new(), stderr: String::new() };
        assert_eq!(killed.error_message(), "TTTGate did not finish");
    }

    #[cfg(windows)]
    #[test]
    fn the_input_reaches_standard_input() {
        let cmd = Path::new(r"C:\Windows\System32\cmd.exe");
        let output = run_with_input(cmd, &["/v:on".into(), "/c".into(), "set /p X=& echo got !X!".into()], &std::env::temp_dir(), "abc\n");
        assert_eq!(output.code, Some(0));
        assert_eq!(output.stdout.trim(), "got abc");
    }

    #[cfg(windows)]
    #[test]
    fn a_command_runs_without_a_window_and_its_output_is_read() {
        let cmd = Path::new(r"C:\Windows\System32\cmd.exe");
        let output = run(cmd, &["/c".into(), "echo hello& echo oops 1>&2& exit 3".into()], &std::env::temp_dir());
        assert_eq!(output.code, Some(3));
        assert_eq!(output.stdout.trim(), "hello");
        assert_eq!(output.stderr.trim(), "oops");
    }
}
