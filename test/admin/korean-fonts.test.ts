import fs from "fs";
import path from "path";

// 이슈 349 FR-13·AC-9 — 번들 글꼴은 라틴 문자만 담는다(결정 D6). 한국어 글자는 시스템의 한글 글꼴로 보이게
// 글꼴 목록에 한글 글꼴 대체 이름을 더한다. 글꼴 파일은 더하지 않는다.
const root = path.resolve(__dirname, "../..");
const css = fs.readFileSync(path.join(root, "admin/src/app.css"), "utf8");
const KOREAN_FALLBACKS = ['"Apple SD Gothic Neo"', '"Malgun Gothic"', '"Noto Sans KR"'];

const valueOf = (name: string): string => css.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1] ?? "";

test.each(["--ff-display", "--ff-ui"])("%s 에 한글 글꼴 대체 이름이 있다", (name) => {
    const value = valueOf(name);
    expect(value).not.toBe("");
    expect(KOREAN_FALLBACKS.filter((font) => !value.includes(font))).toEqual([]);
    // 번들 라틴 글꼴이 먼저다. 한글 대체 이름은 그 뒤, 마지막 일반 글꼴 이름(serif·sans-serif) 앞에 둔다.
    const families = value.split(",").map((family) => family.trim());
    expect(families.indexOf(KOREAN_FALLBACKS[0])).toBeGreaterThan(0);
    expect(families.indexOf(KOREAN_FALLBACKS[2])).toBeLessThan(families.length - 1);
});

test("글꼴 파일은 번들 라틴 글꼴 7개뿐이다", () => {
    const files = fs.readdirSync(path.join(root, "admin/src/assets/fonts"));
    expect(files.filter((file) => /\.(woff2?|ttf|otf)$/i.test(file))).toHaveLength(7);
    expect(files.filter((file) => /kr|korean|cjk/i.test(file))).toEqual([]);
});
