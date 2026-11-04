// 콘솔 창 없이 뜨게 한다(릴리스 빌드).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tttgate_launcher_lib::run();
}
