const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {isValidReleaseVersion} = require('./validate-release-version.cjs');

const version = process.argv[2];
const root = path.resolve(process.argv[3] || path.join(__dirname, '..'));
const binaryDirectory = path.join(root, 'dist/bin');
const platforms = ['linux-x64', 'linux-arm64', 'win-x64', 'win-arm64', 'alpine-x64'];
const fail = (message) => { console.error(message); process.exit(1); };
if(!isValidReleaseVersion(version)) fail('Invalid release version');

const entries = platforms.map(platform => ({
    binary: `TTTGate-${platform}${platform.startsWith('win-') ? '.exe' : ''}`,
    archive: path.join(root, `TTTGate-${version}-${platform}.${platform.startsWith('win-') ? 'zip' : 'tar.gz'}`),
    zip: platform.startsWith('win-'),
}));
for(const entry of entries) {
    const file = path.join(binaryDirectory, entry.binary);
    if(!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) fail(`Missing or empty binary: ${entry.binary}`);
}
for(const entry of entries) {
    // Remove only this exact output so ZIP cannot retain entries from an old archive.
    if(fs.existsSync(entry.archive)) fs.unlinkSync(entry.archive);
    const windowsZip = entry.zip && process.platform === 'win32';
    const command = entry.zip && !windowsZip ? 'zip' : 'tar';
    const args = windowsZip ? ['--format', 'zip', '-cf', entry.archive, entry.binary]
        : entry.zip ? ['-q', entry.archive, entry.binary] : ['-czf', entry.archive, entry.binary];
    const result = spawnSync(command, args, {cwd: binaryDirectory, windowsHide: true, stdio: 'inherit'});
    if(result.error || result.status !== 0) fail(`Archive command failed for ${entry.binary}: ${result.error?.message || result.status}`);
    if(!fs.existsSync(entry.archive) || !fs.statSync(entry.archive).isFile() || fs.statSync(entry.archive).size === 0) fail(`Missing or empty archive: ${entry.archive}`);
}
