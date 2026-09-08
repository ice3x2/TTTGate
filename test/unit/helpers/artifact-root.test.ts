import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

test("artifact root created below an owned temporary-parent alias records its canonical path and cleans normally", () => {
    const parent = fs.realpathSync(os.tmpdir());
    const outer = fs.realpathSync(fs.mkdtempSync(path.join(parent, "artifact-alias-60-")));
    const evidence = fs.mkdtempSync(path.join(parent, "artifact-alias-60-evidence-"));
    const target = path.join(outer, "target"), alias = path.join(outer, "alias");
    let created: string | undefined;
    const facts: Record<string, unknown> = {outer, target, alias};
    const verifyOuter = () => {
        expect(fs.realpathSync(outer)).toBe(outer);
        expect(fs.lstatSync(outer).isSymbolicLink()).toBe(false);
    };
    try {
        fs.mkdirSync(target);
        fs.writeFileSync(path.join(target, "sibling.txt"), "owned sibling preserved");
        fs.symlinkSync(target, alias, "junction");
        expect(fs.lstatSync(alias).isSymbolicLink()).toBe(true);
        expect(fs.realpathSync(alias)).toBe(target);
        const receipt = path.join(evidence, "child.json");
        const child = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only',
            path.resolve(__dirname, '../../fixtures/artifact-root-alias.cjs'), target, receipt], {
            cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', timeout: 10000, windowsHide: true,
            env: {...process.env, TMP: alias, TEMP: alias, TMPDIR: alias},
        });
        expect(child.error).toBeUndefined();
        expect(child.signal).toBeNull();
        const result = JSON.parse(fs.readFileSync(receipt, 'utf8'));
        created = result.canonical as string;
        Object.assign(facts, {childStatus: child.status, child: result});
        expect(path.dirname(created)).toBe(target);
        expect(result.createdWithinTarget).toBe(true);
        expect({status: child.status, failure: result.failure, stage: result.stage}).toEqual({status: 0, failure: undefined, stage: 'complete'});
        expect(result.recorded).toBe(created);
        expect(fs.existsSync(created)).toBe(false);
        expect(fs.readFileSync(path.join(target, "sibling.txt"), "utf8")).toBe("owned sibling preserved");
        facts.passed = true;
    } catch(error) {
        facts.failure = String(error);
        throw error;
    } finally {
        if(created) facts.existsAfterAttempt = fs.existsSync(created);
        fs.writeFileSync(path.join(evidence, "receipt.json"), JSON.stringify(facts, null, 2));
        console.log(`Artifact root alias evidence: ${evidence}`);
        verifyOuter();
        if(fs.existsSync(alias)) {
            expect(fs.lstatSync(alias).isSymbolicLink()).toBe(true);
            expect(fs.realpathSync(alias)).toBe(target);
            fs.unlinkSync(alias); // Remove only the alias, never recursively follow it.
        }
        if(created && fs.existsSync(created)) {
            expect(path.dirname(created)).toBe(target);
            expect(fs.realpathSync(created)).toBe(created);
            expect(fs.lstatSync(created).isSymbolicLink()).toBe(false);
            fs.rmSync(created, {recursive: true});
        }
        verifyOuter();
        expect(fs.realpathSync(target)).toBe(target);
        expect(fs.lstatSync(target).isSymbolicLink()).toBe(false);
        fs.rmSync(outer, {recursive: true});
    }
});
