const fs = require('node:fs');
const path = require('node:path');
const createArchive = require('./create-archive.cjs');
const {isValidReleaseVersion} = require('./validate-release-version.cjs');
const getWebValidationError = require('./validate-web.cjs');

const version = process.argv[2];
const root = path.resolve(process.argv[3] || path.join(__dirname, '..'));
const binaryDirectory = path.join(root, 'dist/bin');
const platforms = ['linux-x64', 'linux-arm64', 'win-x64', 'win-arm64', 'alpine-x64'];
const fail = (message) => { console.error(message); process.exit(1); };
if(!isValidReleaseVersion(version)) fail('Invalid release version');

// #322: Windows 묶음에는 Windows 런처(x64)를 함께 넣는다. arm64 Windows 는 x64 앱을 에뮬레이션으로 실행한다.
const WINDOWS_LAUNCHER = 'TTTGate-launcher-win-x64.exe';
const entries = platforms.map(platform => ({
    binary: `TTTGate-${platform}${platform.startsWith('win-') ? '.exe' : ''}`,
    extras: platform.startsWith('win-') ? [WINDOWS_LAUNCHER] : [],
    archive: path.join(root, `TTTGate-${version}-${platform}.${platform.startsWith('win-') ? 'zip' : 'tar.gz'}`),
}));
for(const name of [...new Set(entries.flatMap(entry => [entry.binary, ...entry.extras]))]) {
    const file = path.join(binaryDirectory, name);
    if(!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) fail(`Missing or empty binary: ${name}`);
}
const distribution = path.join(root, 'dist');
const webError = getWebValidationError(distribution);
if(webError) fail(webError);
for(const entry of entries) createArchive(entry.archive, distribution, [`bin/${entry.binary}`, ...entry.extras.map(name => `bin/${name}`), 'web']);
