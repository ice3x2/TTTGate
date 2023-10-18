const rimraf = require("rimraf");
const Path = require("path");
const fsEx = require('fs-extra');
const fs = require('fs');
const { exec, execSync} = require('child_process');

rimraf.sync(Path.join(process.cwd(), 'dist'));
fs.mkdirSync(Path.join(process.cwd(), 'dist'));

execSync(`npm --prefix ${Path.join(process.cwd(), 'admin')} run build`);
fsEx.moveSync(Path.join(process.cwd(), 'web'), Path.join(process.cwd(), 'dist', 'web'), { overwrite: true });

execSync(`npm --prefix ${Path.join(process.cwd())} run build`);
execSync(`npm --prefix ${Path.join(process.cwd())} run pkg`);


/*
"node18-linux-arm64",
      "node18-win-arm64",
      "node18-win-x64",
      "node18-linux-x64",
      "node18-alpine-x64"
 */