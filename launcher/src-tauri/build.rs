fn main() {
    // 런처 버전은 tauri.conf.json 이 package.json 에서 읽는다. 버전이 바뀌면 다시 빌드한다.
    println!("cargo:rerun-if-changed=../../package.json");
    tauri_build::build()
}
