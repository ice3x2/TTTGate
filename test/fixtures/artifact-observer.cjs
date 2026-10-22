// Observe actual generated report bytes; inject failure only after the real report write.
const fs = require('node:fs');
const path = require('node:path');
const originalWrite = fs.writeFileSync, originalAppend = fs.appendFileSync;
const records = new Map();
let injected = false;
function observe(file) {
    if(!/auth-compare\.json$|req-04-grep\.json$|req-09-sessions\.csv$/.test(String(file))) return;
    records.set(String(file), fs.readFileSync(file, 'utf8'));
    if(String(file).endsWith('req-04-grep.json')) {
        // The scanner is a separate child; read its report produced before this filtered report.
        const walk = dir => { for(const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const full = path.join(dir, entry.name);
            if(entry.isDirectory() && !entry.isSymbolicLink()) walk(full);
            else if(entry.isFile() && entry.name === 'auth-compare.json') records.set(full, fs.readFileSync(full, 'utf8'));
        }};
        walk(process.cwd()); walk(process.env.TEMP);
    }
    originalWrite(path.join(process.env.ARTIFACT_EVIDENCE, process.env.ARTIFACT_MODE + '-artifacts.json'),
        JSON.stringify([...records].map(([file, content]) => ({file, content})), null, 2));
    if(process.env.ARTIFACT_FAIL === '1' && !injected && /req-04-grep\.json$|req-09-sessions\.csv$/.test(String(file)) &&
        (!String(file).endsWith('.csv') || records.get(String(file)).includes('3b,range_guard,pass'))) {
        injected = true; throw new Error('owned-artifact-assertion');
    }
}
fs.writeFileSync = function(file, ...args) { const result = originalWrite.call(fs, file, ...args); observe(file); return result; };
fs.appendFileSync = function(file, ...args) { const result = originalAppend.call(fs, file, ...args); observe(file); return result; };
afterAll(() => { fs.writeFileSync = originalWrite; fs.appendFileSync = originalAppend; });
