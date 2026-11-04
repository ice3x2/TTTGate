'use strict';
// #321: pkg 가 만든 Windows 실행 파일은 Node.js 의 아이콘을 그대로 가진다. 빌드 뒤에 붉은 터널 아이콘으로 바꾼다.
// pkg 문서가 권하는 resedit 을 쓴다(https://yao-pkg.github.io/pkg/guide/advanced-windows-metadata).
// 다른 도구는 pkg 가 덧붙인 내용을 깨뜨릴 수 있다.
const fs = require('node:fs');
const Path = require('node:path');
const ResEdit = require('resedit');

/** 관리 화면의 파비콘을 실행 파일 아이콘으로도 쓴다. 아이콘 원본은 한 곳에만 둔다. */
const EXE_ICON_FILE = Path.join(__dirname, '..', 'admin', 'public', 'favicon.ico');
/** Windows 가 실행 파일 아이콘으로 쓰는 아이콘 그룹 ID 와 언어(영어-미국). */
const ICON_GROUP_ID = 1;
const LANGUAGE = 1033;

/**
 * exePath 의 아이콘을 EXE_ICON_FILE 로 바꾼다. Windows 실행 파일(PE)이 아니면 예외를 던져 빌드를 멈춘다.
 * 아이콘 없는 실행 파일을 조용히 내보내지 않기 위해서다.
 */
const setExeIcon = (exePath, iconFile = EXE_ICON_FILE) => {
    const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), {ignoreCert: true});
    const resource = ResEdit.NtExecutableResource.from(exe);
    const icon = ResEdit.Data.IconFile.from(fs.readFileSync(iconFile));
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resource.entries, ICON_GROUP_ID, LANGUAGE, icon.icons.map((item) => item.data));
    resource.outputResource(exe);
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));
};

module.exports = {setExeIcon, EXE_ICON_FILE};
