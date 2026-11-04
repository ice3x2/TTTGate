//! 런처만의 설정(#322 REQ-1·REQ-5·REQ-12): 고른 모드, 원격 관리 화면 동의, 자동 시작. TTTGate 설정과 같은 config 폴더에 둔다.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const SETTINGS_FILE_NAME: &str = "launcher.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Server,
    Client,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub mode: Option<Mode>,
    /// 사용자가 관리 화면을 다른 PC 에 여는 위험을 확인했다. 서버를 다시 띄울 때 `-allowLegacyAdminRemote` 를 붙인다.
    pub allow_remote_admin: bool,
    pub autostart: bool,
}

pub fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join(SETTINGS_FILE_NAME)
}

/// 파일이 없거나 읽을 수 없으면 기본값(모드 없음, 자동 시작 끔)이다.
pub fn load(config_dir: &Path) -> Settings {
    std::fs::read_to_string(settings_path(config_dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(config_dir: &Path, settings: &Settings) -> std::io::Result<()> {
    std::fs::create_dir_all(config_dir)?;
    let text = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
    // 쓰는 도중 끊겨도 앞선 설정이 깨지지 않게 임시 파일에 쓴 뒤 이름을 바꾼다.
    let path = settings_path(config_dir);
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text)?;
    std::fs::rename(&temp, &path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tttgate-launcher-settings-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn ac1_missing_or_broken_settings_have_no_mode_and_no_autostart() {
        let dir = temp_dir("missing");
        assert_eq!(load(&dir), Settings { mode: None, allow_remote_admin: false, autostart: false });
        fs::create_dir_all(&dir).unwrap();
        fs::write(settings_path(&dir), "{broken").unwrap();
        assert_eq!(load(&dir), Settings::default());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn ac1_the_chosen_mode_survives_a_restart() {
        let dir = temp_dir("roundtrip");
        let settings = Settings { mode: Some(Mode::Client), allow_remote_admin: true, autostart: true };
        save(&dir, &settings).unwrap();
        assert_eq!(load(&dir), settings);
        assert!(fs::read_to_string(settings_path(&dir)).unwrap().contains("\"client\""));
        fs::remove_dir_all(&dir).unwrap();
    }
}
