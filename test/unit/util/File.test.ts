import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import File from "../../../src/util/File";

describe("File", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "tttgate-file-"));
    });

    afterEach(() => {
        fs.rmSync(root, {recursive: true, force: true});
    });

    it("builds its path from the constructor arguments, defaulting to the current working directory", () => {
        expect(new File().toString()).toBe(process.cwd());

        const file = new File(root, "a", "b.txt");
        expect(file.toString()).toBe(path.join(root, "a", "b.txt"));
        expect(file.getName()).toBe("b.txt");
        expect(file.getParent()).toBe(path.resolve(root, "a"));
        expect(file.getParentFile().toString()).toBe(path.resolve(root, "a"));
    });

    it("reports a non-existent path consistently across every accessor", () => {
        const missing = new File(root, "missing.txt");

        expect(missing.exists()).toBe(false);
        expect(missing.isFile()).toBe(false);
        expect(missing.isDirectory()).toBe(false);
        expect(missing.canRead()).toBe(false);
        expect(missing.canWrite()).toBe(false);
        expect(missing.delete()).toBe(false);
        expect(missing.deleteAll()).toBe(false);
        expect(missing.length()).toBe(0);
        expect(missing.lastModified()).toBe(0);
        expect(missing.creation()).toBe(0);
        expect(() => missing.list()).toThrow();

        expect(missing.createNewFile()).toBe(true);
        expect(missing.exists()).toBe(true);
    });

    it("createNewFile refuses to overwrite an existing file, and length/timestamps reflect real content", () => {
        const target = new File(root, "new.txt");

        expect(target.createNewFile()).toBe(true);
        expect(target.createNewFile()).toBe(false);
        expect(target.exists()).toBe(true);
        expect(target.isFile()).toBe(true);
        expect(target.isDirectory()).toBe(false);
        expect(target.length()).toBe(0);

        fs.writeFileSync(target.toString(), "abcdef");

        expect(target.length()).toBe(6);
        expect(target.lastModified()).toBeGreaterThan(0);
        expect(target.creation()).toBeGreaterThan(0);
    });

    it("lists directory entries as absolute paths and as File objects, and returns nothing for a plain file", () => {
        const dir = new File(root, "listing");
        fs.mkdirSync(dir.toString());
        fs.writeFileSync(path.join(dir.toString(), "a.txt"), "");
        fs.writeFileSync(path.join(dir.toString(), "b.txt"), "");

        expect(dir.list().slice().sort()).toEqual(
            [path.join(dir.toString(), "a.txt"), path.join(dir.toString(), "b.txt")].sort()
        );

        const files = dir.listFiles();
        expect(files).toHaveLength(2);
        expect(files.map((f) => f.getName()).sort()).toEqual(["a.txt", "b.txt"]);

        const plainFile = new File(dir.toString(), "a.txt");
        expect(plainFile.list()).toEqual([]);
    });

    it("mkdir creates one level and mkdirs creates nested levels, both refusing existing or parentless paths", () => {
        const single = new File(root, "d1");
        expect(single.mkdir()).toBe(true);
        expect(single.mkdir()).toBe(false);

        const nested = new File(root, "x", "y");
        expect(nested.mkdirs()).toBe(true);
        expect(nested.mkdirs()).toBe(false);

        const withoutParent = new File(root, "nope", "child");
        expect(withoutParent.mkdir()).toBe(false);
    });

    it("delete removes only an empty directory or a plain file, while deleteAll removes a non-empty directory", () => {
        const nonEmptyDir = new File(root, "ne");
        fs.mkdirSync(nonEmptyDir.toString());
        fs.writeFileSync(path.join(nonEmptyDir.toString(), "inner.txt"), "x");

        expect(nonEmptyDir.delete()).toBe(false);
        expect(nonEmptyDir.deleteAll()).toBe(true);
        expect(nonEmptyDir.exists()).toBe(false);

        const emptyDir = new File(root, "empty");
        fs.mkdirSync(emptyDir.toString());
        expect(emptyDir.delete()).toBe(true);

        const plainFile = new File(root, "plain.txt");
        fs.writeFileSync(plainFile.toString(), "");
        expect(plainFile.delete()).toBe(true);
    });

    it("canRead and canWrite report true for an existing file", () => {
        const readable = new File(root, "readable.txt");
        fs.writeFileSync(readable.toString(), "x");

        expect(readable.canRead()).toBe(true);
        expect(readable.canWrite()).toBe(true);
    });

    it("rename moves to a string path, creating missing parent directories", () => {
        const source = new File(root, "source.txt");
        fs.writeFileSync(source.toString(), "x");
        const oldPath = source.toString();
        const target = path.join(root, "moved", "x.txt");

        expect(source.rename(target)).toBe(true);

        expect(source.toString()).toBe(target);
        expect(fs.existsSync(target)).toBe(true);
        expect(fs.existsSync(oldPath)).toBe(false);
    });

    it("rename fails and leaves the original untouched when the destination already exists", () => {
        const another = new File(root, "another.txt");
        fs.writeFileSync(another.toString(), "y");
        const existingTargetPath = path.join(root, "existing.txt");
        fs.writeFileSync(existingTargetPath, "z");

        expect(another.rename(existingTargetPath)).toBe(false);

        expect(another.toString()).toBe(path.join(root, "another.txt"));
        expect(fs.existsSync(another.toString())).toBe(true);
    });

    it("rename accepts a File destination just like a string path", () => {
        const third = new File(root, "third.txt");
        fs.writeFileSync(third.toString(), "v");
        const destination = new File(root, "third-renamed.txt");

        expect(third.rename(destination)).toBe(true);

        expect(fs.existsSync(destination.toString())).toBe(true);
    });

    it("rename returns false for a destination that is neither a string nor a File", () => {
        const fourth = new File(root, "fourth.txt");
        fs.writeFileSync(fourth.toString(), "w");

        expect(fourth.rename(123 as any)).toBe(false);
        expect(fs.existsSync(fourth.toString())).toBe(true);
    });

    it("createNewFile returns false when the write itself fails, such as a missing parent directory", () => {
        const orphan = new File(root, "missing-parent", "child.txt");

        expect(orphan.createNewFile()).toBe(false);
        expect(orphan.exists()).toBe(false);
    });

    it("mkdirs returns false when a path segment collides with an existing file", () => {
        const blocker = new File(root, "blocker");
        fs.writeFileSync(blocker.toString(), "x");
        const nested = new File(root, "blocker", "child");

        expect(nested.mkdirs()).toBe(false);
    });

    it("rename swaps through a temp path when the destination string textually extends the source path, then completes", () => {
        const source = new File(root, "abc");
        fs.writeFileSync(source.toString(), "x");
        const destinationPath = path.join(root, "abcdef");

        expect(source.rename(destinationPath)).toBe(true);

        expect(source.toString()).toBe(destinationPath);
        expect(fs.existsSync(destinationPath)).toBe(true);
    });

    it("rename reverts its temp-path swap when the destination already exists", () => {
        const source = new File(root, "xyz");
        fs.writeFileSync(source.toString(), "original");
        const destinationPath = path.join(root, "xyzabc");
        fs.writeFileSync(destinationPath, "taken");

        expect(source.rename(destinationPath)).toBe(false);

        expect(source.toString()).toBe(path.join(root, "xyz"));
        expect(fs.readFileSync(source.toString(), "utf8")).toBe("original");
        expect(fs.readFileSync(destinationPath, "utf8")).toBe("taken");
    });

    it("rename reverts its temp-path swap when the destination parent cannot be created", () => {
        const source = new File(root, "qqq");
        fs.writeFileSync(source.toString(), "original");
        const blocker = new File(root, "qqqXXX");
        fs.writeFileSync(blocker.toString(), "block");
        const destinationPath = path.join(root, "qqqXXX", "deep", "target");

        expect(source.rename(destinationPath)).toBe(false);

        expect(source.toString()).toBe(path.join(root, "qqq"));
        expect(fs.readFileSync(source.toString(), "utf8")).toBe("original");
    });

    it("rename returns false and leaves the source in place when the final filesystem rename fails", () => {
        const source = new File(root, "final-src.txt");
        fs.writeFileSync(source.toString(), "x");
        const invalidDestination = path.join(root, "bad<name.txt");

        expect(source.rename(invalidDestination)).toBe(false);

        expect(source.toString()).toBe(path.join(root, "final-src.txt"));
        expect(fs.existsSync(source.toString())).toBe(true);
    });
});
