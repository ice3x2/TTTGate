// #322: Windows 런처(launcher/, Tauri 2)를 빌드해 <binDir>/TTTGate-launcher-win-x64.exe 로 둔다.
// 런처는 Windows 에서만 빌드된다. 다른 OS 에서는 건너뛰었다고 알리고 성공으로 끝낸다(릴리스는 Windows 작업이 따로 만든다).
// 사용: node scripts/build-launcher.cjs <binDir>
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const LAUNCHER_FILE_NAME = 'TTTGate-launcher-win-x64.exe';

const launcherBuildPlan = (platform, root, binDir) => {
    if(platform !== 'win32') {
        return {skip: true, reason: 'the launcher is built on Windows only (see the Windows Launcher and Release workflows)'};
    }
    const crate = path.join(root, 'launcher', 'src-tauri');
    return {
        skip: false,
        // rust-toolchain.toml 은 현재 폴더에서 찾으므로 그 폴더에서 cargo 를 실행한다.
        cwd: crate,
        cargoArgs: ['build', '--release', '--locked'],
        source: path.join(crate, 'target', 'release', 'TTTGate-launcher.exe'),
        target: path.join(binDir, LAUNCHER_FILE_NAME)
    };
};

const main = () => {
    const binDir = process.argv[2];
    if(!binDir) {
        console.error('usage: node scripts/build-launcher.cjs <binDir>');
        return 2;
    }
    const root = path.resolve(__dirname, '..');
    const plan = launcherBuildPlan(process.platform, root, path.resolve(root, binDir));
    if(plan.skip) {
        console.log(`Windows launcher skipped: ${plan.reason}`);
        return 0;
    }
    const result = spawnSync('cargo', plan.cargoArgs, {cwd: plan.cwd, stdio: 'inherit', windowsHide: true});
    if(result.error || result.status !== 0) {
        console.error(result.error && result.error.code === 'ENOENT'
            ? 'cargo was not found. Install Rust from https://rustup.rs to build the Windows launcher.'
            : `cargo ${plan.cargoArgs.join(' ')} failed`);
        return result.status || 1;
    }
    fs.mkdirSync(path.dirname(plan.target), {recursive: true});
    fs.copyFileSync(plan.source, plan.target);
    console.log(`Built ${plan.target}`);
    return 0;
};

if(require.main === module) process.exitCode = main();

module.exports = {launcherBuildPlan, LAUNCHER_FILE_NAME};
