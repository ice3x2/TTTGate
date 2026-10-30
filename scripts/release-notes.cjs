// #290 — 릴리스 노트 머리말. 변경 목록은 GitHub 가 만든다(generate_release_notes). 이 스크립트는 git 이력에 기대지 않는다.
// 사용: node scripts/release-notes.cjs <version> <commit>
const {isValidReleaseVersion} = require('./validate-release-version.cjs');

const [version, commit = ''] = process.argv.slice(2);
if(!isValidReleaseVersion(version)) {
    console.error('Invalid release version');
    process.exit(1);
}

const lines = [
    `## TTTGate ${version}`,
    '',
    '### Downloads',
    '',
    '#### Source distribution (Node.js 24+)',
    `- \`TTTGate-${version}-dist.tar.gz\``,
    `- \`TTTGate-${version}-dist.zip\``,
    '',
    '#### Platform binaries',
    `- \`TTTGate-${version}-linux-x64.tar.gz\` - Linux x64`,
    `- \`TTTGate-${version}-linux-arm64.tar.gz\` - Linux ARM64`,
    `- \`TTTGate-${version}-win-x64.zip\` - Windows x64`,
    `- \`TTTGate-${version}-win-arm64.zip\` - Windows ARM64`,
    `- \`TTTGate-${version}-alpine-x64.tar.gz\` - Alpine Linux x64`,
    '',
    '### Installation',
    '',
    '#### From the source distribution',
    '```bash',
    `tar -xzf TTTGate-${version}-dist.tar.gz`,
    'npm install --omit=dev',
    'node app.js server -adminPort 9300',
    'node app.js client -addr <server_address>',
    '```',
    '',
    '#### From a binary',
    '```bash',
    `tar -xzf TTTGate-${version}-linux-x64.tar.gz`,
    './bin/TTTGate-linux-x64 server -adminPort 9300',
    '# Windows: extract the zip file, then run',
    'bin/TTTGate-win-x64.exe server -adminPort 9300',
    '```',
    '',
    '### Requirements',
    '- Node.js 24+ (source distribution only)',
    '- Platforms: Linux, Windows, Alpine Linux (x64/ARM64)',
    '',
    '### Build',
    `- Commit: \`${commit}\``,
    '',
    'Read "Upgrading an Existing Server" in README.md before you replace a running server.',
    '',
];
process.stdout.write(lines.join('\n'));
