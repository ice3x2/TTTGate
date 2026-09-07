const fs = require("node:fs");
const crypto = require("node:crypto");

if(Number(process.versions.node.split(".")[0]) !== 24) {
    throw new Error(`Expected packaged Node 24, got ${process.versions.node}`);
}
console.log(JSON.stringify({
    node: process.versions.node, platform: process.platform, arch: process.arch,
    packaged: Boolean(process.pkg),
    sourceReadable: fs.readFileSync(__filename, "utf8").includes("sourceReadable"),
    sha256: crypto.createHash("sha256").update("TTTGate").digest("hex"),
}));
