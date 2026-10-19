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

const entries = platforms.map(platform => ({
    binary: `TTTGate-${platform}${platform.startsWith('win-') ? '.exe' : ''}`,
    archive: path.join(root, `TTTGate-${version}-${platform}.${platform.startsWith('win-') ? 'zip' : 'tar.gz'}`),
}));
for(const entry of entries) {
    const file = path.join(binaryDirectory, entry.binary);
    if(!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) fail(`Missing or empty binary: ${entry.binary}`);
}
const distribution = path.join(root, 'dist');
const webError = getWebValidationError(distribution);
if(webError) fail(webError);
for(const entry of entries) createArchive(entry.archive, distribution, [`bin/${entry.binary}`, 'web']);
