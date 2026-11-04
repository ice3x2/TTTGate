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

fn run_inner(cli: &Path, args: &[String], work_dir: &Path, input: Option<&str>) -> CliOutput {
    let unique = format!("{}-{}", std::process::id(), std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let out_file = temp_file(&format!("tttgate-launcher-{}.out", unique));
    let err_file = temp_file(&format!("tttgate-launcher-{}.err", unique));
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

fn temp_file(name: &str) -> PathBuf {
    std::env::temp_dir().join(name)
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
