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
    let unique = format!("{}-{}", std::process::id(), std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let out_file = temp_file(&format!("tttgate-launcher-{}.out", unique));
    let err_file = temp_file(&format!("tttgate-launcher-{}.err", unique));
    let result = spawn_and_wait(cli, args, work_dir, &out_file, &err_file);
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

fn spawn_and_wait(cli: &Path, args: &[String], work_dir: &Path, out_file: &Path, err_file: &Path) -> std::io::Result<Option<i32>> {
    let mut command = Command::new(cli);
    command.args(args).current_dir(work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(fs::File::create(out_file)?))
        .stderr(Stdio::from(fs::File::create(err_file)?));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(command.status()?.code())
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
    fn a_command_runs_without_a_window_and_its_output_is_read() {
        let cmd = Path::new(r"C:\Windows\System32\cmd.exe");
        let output = run(cmd, &["/c".into(), "echo hello& echo oops 1>&2& exit 3".into()], &std::env::temp_dir());
        assert_eq!(output.code, Some(3));
        assert_eq!(output.stdout.trim(), "hello");
        assert_eq!(output.stderr.trim(), "oops");
    }
}
