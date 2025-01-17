const rimraf = require("rimraf");
const Path = require("path");
const fsEx = require('fs-extra');
const fs = require('fs');
const { exec, execSync} = require('child_process');

rimraf.sync(Path.join(process.cwd(), 'dist'));
rimraf.sync(Path.join(process.cwd(), 'dist.js'));

fs.mkdirSync(Path.join(process.cwd(), 'dist'));

execSync(`npm --prefix ${Path.join(process.cwd(), 'admin')} run build`);

console.log(Path.join(process.cwd(), 'dist', 'web'))
fsEx.mkdirsSync(Path.join(process.cwd(), 'dist'), { overwrite: true });
fsEx.mkdirsSync(Path.join(process.cwd(), 'dist', 'web'), { overwrite: true });
fsEx.copySync(Path.join(process.cwd(),'admin', 'dist'), Path.join(process.cwd(), 'dist', 'web'), { overwrite: true });

execSync(`npm --prefix ${Path.join(process.cwd())} run build`);

fs.mkdirSync(Path.join(process.cwd(), 'dist.js'));
fs.mkdirSync(Path.join(process.cwd(), 'dist.js', 'bin'));
fs.mkdirSync(Path.join(process.cwd(), 'dist.js', 'web'));
fsEx.copySync(Path.join(process.cwd(), 'build', 'src'), Path.join(process.cwd(), 'dist.js'), { overwrite: true });
fsEx.copySync(Path.join(process.cwd(),'admin', 'dist'), Path.join(process.cwd(),  'dist.js', 'web'), { overwrite: true });
fsEx.copySync(Path.join(process.cwd(), 'package-build.json'), Path.join(process.cwd(), 'dist.js', 'package.json'), { overwrite: true });







execSync(`npm --prefix ${Path.join(process.cwd())} run pkg`);


/*
"node18-linux-arm64",
      "node18-win-arm64",
      "node18-win-x64",
      "node18-linux-x64",
      "node18-alpine-x64"
 */