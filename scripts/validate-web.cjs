const fs = require('node:fs');
const path = require('node:path');

module.exports = function getWebValidationError(root) {
    const missing = relative => {
        const file = path.join(root, relative);
        return !fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0;
    };
    if(missing('web/index.html')) return 'Missing or empty source file: web/index.html';
    const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
    const assets = [...html.matchAll(/(?:src|href)=["']\/?(assets\/[^"']+)["']/g)];
    if(assets.length === 0) return 'Missing production web assets';
    for(const asset of assets) {
        if(missing(`web/${asset[1]}`)) return `Missing or empty source file: web/${asset[1]}`;
    }
};
