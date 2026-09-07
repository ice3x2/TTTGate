const fs = require('node:fs');
const path = require('node:path');
const createArchive = require('./create-archive.cjs');
const {isValidReleaseVersion} = require('./validate-release-version.cjs');

const version = process.argv[2];
const root = path.resolve(process.argv[3] || path.join(__dirname, '..'));
const source = path.join(root, 'dist.js');
const fail = message => { console.error(message); process.exit(1); };
if(!isValidReleaseVersion(version)) fail('Invalid release version');
const requireFile = relative => {
    const file = path.join(source, relative);
    if(!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) fail(`Missing or empty source file: ${relative}`);
};
for(const file of ['app.js', 'package.json', 'web/index.html']) requireFile(file);
if(!fs.existsSync(path.join(source, 'bin')) || !fs.statSync(path.join(source, 'bin')).isDirectory()) fail('Missing runtime directory: bin');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
if(manifest.main !== 'app.js' || manifest.engines?.node !== '>=24.0.0') fail('Invalid source package.json entrypoint or Node minimum');
const html = fs.readFileSync(path.join(source, 'web/index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)=["']\/?(assets\/[^"']+)["']/g)];
if(assets.length === 0) fail('Missing production web assets');
for(const asset of assets) requireFile(`web/${asset[1]}`);
for(const extension of ['tar.gz', 'zip']) {
    createArchive(path.join(root, `TTTGate-${version}-dist.${extension}`), source, ['.']);
}
