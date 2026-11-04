'use strict';
// #321: pkg 가 만든 Windows 실행 파일은 Node.js 의 아이콘을 그대로 가진다. 빌드 뒤에 붉은 터널 아이콘으로 바꾼다.
// pkg 문서가 권하는 resedit 을 쓴다(https://yao-pkg.github.io/pkg/guide/advanced-windows-metadata).
// 사용법: node scripts/set-exe-icon.cjs <bin 폴더> [기대하는 Windows 실행 파일 수]
// npm run icon:exe 가 dist/bin 으로 부른다. 수를 주지 않으면 package.json 의 pkg 대상 가운데 Windows 대상 수를 쓴다.
const fs = require('node:fs');
const Path = require('node:path');
const ResEdit = require('resedit');

/** 관리 화면의 파비콘을 실행 파일 아이콘으로도 쓴다. 아이콘 원본은 한 곳에만 둔다. */
const EXE_ICON_FILE = Path.join(__dirname, '..', 'admin', 'public', 'favicon.ico');
/** Windows 가 실행 파일 아이콘으로 쓰는 아이콘 그룹 ID 와 언어(영어-미국, Node.js 원본과 같다). */
const ICON_GROUP_ID = 1;
const LANGUAGE = 1033;

/** 실행 파일 끝에 덧붙은 데이터(pkg 의 내용)가 시작하는 곳. 덧붙은 데이터가 없으면 null 이다. */
const appendedDataOffset = (exe, fileLength) => {
    const extra = exe.getExtraData();
    return extra && extra.byteLength > 0 ? fileLength - extra.byteLength : null;
};

/**
 * exePath 의 아이콘을 iconFile 로 바꾼다.
 * pkg 는 덧붙인 데이터의 위치를 실행 파일 안에 절대 위치로 적어 둔다. 아이콘 리소스의 크기가 바뀌어 그 데이터가 밀리면
 * 실행 파일이 시작하자마자 깨지므로, 그런 변경은 거부한다. Windows 실행 파일(PE)이 아니어도 예외를 던진다.
 * 임시 파일에 쓴 뒤 바꿔치기하므로, 실패해도 원래 파일은 그대로 남는다.
 */
const setExeIcon = (exePath, iconFile = EXE_ICON_FILE) => {
    const original = fs.readFileSync(exePath);
    const exe = ResEdit.NtExecutable.from(original, {ignoreCert: true});
    const offsetBefore = appendedDataOffset(exe, original.length);
    const resource = ResEdit.NtExecutableResource.from(exe);
    const icon = ResEdit.Data.IconFile.from(fs.readFileSync(iconFile));
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries, ICON_GROUP_ID, LANGUAGE, icon.icons.map((item) => item.data));
    resource.outputResource(exe);
    const output = Buffer.from(exe.generate());
    const offsetAfter = appendedDataOffset(exe, output.length);
    if(offsetBefore !== null && offsetAfter !== offsetBefore) {
        throw new Error(`${exePath}: the icon resource changes size and would move the appended data `
            + `(${offsetBefore} -> ${offsetAfter}); use a smaller icon file`);
    }
    const temporary = `${exePath}.icon-tmp`;
    fs.writeFileSync(temporary, output);
    fs.renameSync(temporary, exePath);
};

/** package.json 의 pkg 대상 가운데 Windows 대상 수. bin 폴더의 .exe 수가 이와 같아야 한다. */
const windowsTargetCount = () => {
    const manifest = JSON.parse(fs.readFileSync(Path.join(__dirname, '..', 'package.json'), 'utf8'));
    return manifest.pkg.targets.filter((target) => target.includes('-win-')).length;
};

const main = (binDir, expectedArgument) => {
    if(!binDir || !fs.existsSync(binDir)) throw new Error(`bin folder not found: ${binDir}`);
    if(expectedArgument !== undefined && !/^[1-9][0-9]*$/.test(expectedArgument)) {
        throw new Error(`the expected number of Windows executables must be a positive integer: ${expectedArgument}`);
    }
    const exes = fs.readdirSync(binDir).filter((name) => /-win-[^.]+\.exe$/.test(name)).sort();
    const expected = expectedArgument === undefined ? windowsTargetCount() : Number(expectedArgument);
    if(exes.length !== expected) {
        throw new Error(`expected ${expected} Windows executables in ${binDir}, found ${exes.length}: ${exes.join(', ') || 'none'}`);
    }
    for(const name of exes) {
        setExeIcon(Path.join(binDir, name));
        console.log(`icon set: ${name}`);
    }
};

if(require.main === module) {
    try {
        main(process.argv[2], process.argv[3]);
    } catch(error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

module.exports = {setExeIcon, EXE_ICON_FILE};
