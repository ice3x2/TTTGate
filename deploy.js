const Path = require('node:path');
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');

const root = __dirname;
const admin = Path.join(root, 'admin');

const runNpm = (args, cwd, nodeEnv = 'development') => {
    const result = spawnSync('npm', args, {
        cwd, stdio: 'inherit', windowsHide: true,
        // Windows npm is a batch launcher. Arguments are fixed tokens; paths
        // are passed through cwd instead of interpolated into a shell command.
        shell: process.platform === 'win32',
        env: {...process.env, NODE_ENV: nodeEnv},
    });
    if(result.error || result.status !== 0) {
        console.error(`Release command failed: npm ${args.join(' ')}`);
        if(result.error) console.error(result.error);
        process.exitCode = result.status ?? 1;
        return false;
    }
    return true;
};

const main = () => {
    const browser = ['run', 'test:browser:install'];
    if(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true') browser.push('--', '--with-deps');
    const gates = [
        {cwd: root, args: ['ci', '--include=dev', '--no-audit', '--no-fund']},
        {cwd: admin, args: ['ci', '--include=dev', '--no-audit', '--no-fund']},
        {cwd: root, args: browser},
        {cwd: admin, args: ['run', 'check']},
        {cwd: root, args: ['run', 'build', '--', '--force']},
        {cwd: root, args: ['test', '--', '--runInBand'], nodeEnv: 'test'},
        // Browser tests can rebuild admin/dist using test entrypoints.
        {cwd: admin, args: ['run', 'build'], nodeEnv: 'production'},
    ];
    for(const gate of gates) {
        if(!runNpm(gate.args, gate.cwd, gate.nodeEnv)) return;
    }

    // Preserve previous distributions until every validation gate has passed.
    const binaryOutput = Path.join(root, 'dist');
    const sourceOutput = Path.join(root, 'dist.js');
    fs.rmSync(binaryOutput, {recursive: true, force: true});
    fs.rmSync(sourceOutput, {recursive: true, force: true});
    fs.mkdirSync(Path.join(binaryOutput, 'web'), {recursive: true});
    fs.cpSync(Path.join(admin, 'dist'), Path.join(binaryOutput, 'web'), {recursive: true});
    fs.mkdirSync(Path.join(sourceOutput, 'bin'), {recursive: true});
    fs.cpSync(Path.join(root, 'build', 'src'), sourceOutput, {recursive: true});
    fs.cpSync(Path.join(admin, 'dist'), Path.join(sourceOutput, 'web'), {recursive: true});
    fs.copyFileSync(Path.join(root, 'package-build.json'), Path.join(sourceOutput, 'package.json'));
    if(!process.argv.includes('--skip-binaries')) runNpm(['run', 'pkg'], root, 'production');
};

main();
