const fs = require('node:fs');
const {spawnSync} = require('node:child_process');

module.exports = function createArchive(archive, cwd, members) {
    if(fs.existsSync(archive)) fs.unlinkSync(archive);
    const zip = archive.endsWith('.zip');
    const windowsZip = zip && process.platform === 'win32';
    const command = zip && !windowsZip ? 'zip' : 'tar';
    const args = windowsZip ? ['--format', 'zip', '-cf', archive, ...members]
        : zip ? ['-q', '-r', archive, ...members] : ['-czf', archive, ...members];
    const result = spawnSync(command, args, {cwd, windowsHide: true, stdio: 'inherit'});
    if(result.error || result.status !== 0) throw new Error(`Archive command failed: ${result.error?.message || result.status}`);
    if(!fs.existsSync(archive) || !fs.statSync(archive).isFile() || fs.statSync(archive).size === 0) throw new Error(`Missing or empty archive: ${archive}`);
};
