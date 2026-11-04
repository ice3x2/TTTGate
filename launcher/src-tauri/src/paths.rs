//! 런처가 쓰는 폴더. 런처는 CLI 와 같은 bin 폴더에 있고, 설정·로그는 그 위 폴더에 있다(CLI 의 Environment 와 같다).

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct Paths {
    /// bin 의 상위 폴더. CLI 를 이 폴더에서 실행한다.
    pub root_dir: PathBuf,
    pub bin_dir: PathBuf,
    pub config_dir: PathBuf,
    pub logs_dir: PathBuf,
}

pub fn from_exe(exe: &Path) -> Paths {
    let bin_dir = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    let root = bin_dir.parent().map(Path::to_path_buf).unwrap_or_else(|| bin_dir.clone());
    Paths { config_dir: root.join("config"), logs_dir: root.join("logs"), root_dir: root, bin_dir }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_are_next_to_the_bin_folder() {
        let paths = from_exe(Path::new(r"C:\Apps\TTTGate\bin\TTTGate-launcher-win-x64.exe"));
        assert_eq!(paths.bin_dir, PathBuf::from(r"C:\Apps\TTTGate\bin"));
        // CLI 는 이 폴더에서 실행한다. 설치 경로에 "node" 가 들어 있으면 CLI 가 현재 폴더를 루트로 쓰기 때문이다.
        assert_eq!(paths.root_dir, PathBuf::from(r"C:\Apps\TTTGate"));
        assert_eq!(paths.config_dir, PathBuf::from(r"C:\Apps\TTTGate\config"));
        assert_eq!(paths.logs_dir, PathBuf::from(r"C:\Apps\TTTGate\logs"));
    }
}
