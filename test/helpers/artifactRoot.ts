import {lstatSync, mkdtempSync, realpathSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

export function createArtifactRoot(prefix: string) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    return {root, cleanup() {
        const stat = lstatSync(root);
        if(!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root)
            throw new Error(`Artifact root ownership changed; preserved ${root}`);
        rmSync(root, {recursive: true});
    }};
}
