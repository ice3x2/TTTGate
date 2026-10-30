const fs = require('node:fs');
const path = require('node:path');

const isValidReleaseVersion = version => typeof version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version);

module.exports = {isValidReleaseVersion};

// --match-package: 릴리스 태그가 package.json 의 version 과 같아야 한다(#290). 다르면 바이너리가 다른 버전을 말한다.
// package.json 은 현재 디렉터리(워크플로의 저장소 루트)에서 읽는다.
if(require.main === module) {
    const version = process.argv[2];
    if(!isValidReleaseVersion(version)) {
        console.error('Invalid release version');
        process.exitCode = 1;
    } else if(process.argv.includes('--match-package')) {
        const readVersion = (file) => JSON.parse(fs.readFileSync(path.join(process.cwd(), file), 'utf8')).version;
        const expected = readVersion('package.json');
        if(version !== expected) {
            console.error(`Release tag ${version} does not match package.json version ${expected}. Push the tag ${expected} or run the workflow on it.`);
            process.exitCode = 1;
        } else if(fs.existsSync(path.join(process.cwd(), 'package-build.json')) && readVersion('package-build.json') !== expected) {
            // 소스 배포판은 package-build.json 을 package.json 으로 쓰므로 같은 버전이어야 한다.
            console.error(`package-build.json version ${readVersion('package-build.json')} does not match package.json version ${expected}.`);
            process.exitCode = 1;
        }
    }
}
