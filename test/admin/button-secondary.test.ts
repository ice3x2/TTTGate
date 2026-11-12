import fs from "fs";
import path from "path";

// 이슈 365 FR-1·FR-2 — 공용 버튼의 보조 모양 secondary. 테두리가 보이고 누르는 높이가 44px 이상이다.
// 기본값(ghost)은 바꾸지 않는다(AC-3: 대화 상자의 "취소" 모양 유지). 모양은 스타일 규칙이라 원본을 읽어 고정한다.
const source = fs.readFileSync(path.resolve(__dirname, "../../admin/src/ui/Button.svelte"), "utf8");
const ruleOf = (selector: string): string => {
    const match = source.match(new RegExp(`${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : "";
};

test("variant 에 secondary 가 있고 기본값은 ghost 다", () => {
    expect(source).toMatch(/variant\?:\s*'primary'\s*\|\s*'secondary'\s*\|\s*'ghost'\s*\|\s*'danger'/);
    expect(source).toMatch(/variant = 'ghost'/);
});

test("secondary 는 테두리(--line-2)와 바탕을 보이고 높이가 44px 이상이다", () => {
    const rule = ruleOf(".btn.secondary");
    expect(rule).toMatch(/border-color:\s*var\(--line-2\)/);
    expect(rule).toMatch(/background:\s*var\(--bg-2\)/);
    expect(rule).toMatch(/min-height:\s*44px/);
});

test("아이콘만 있는 버튼(icon)은 가로·세로 44px 이고, 보조 기술용 이름을 받는다", () => {
    const rule = ruleOf(".btn.icon");
    expect(rule).toMatch(/width:\s*44px/);
    expect(rule).toMatch(/min-height:\s*44px/);
    expect(source).toMatch(/ariaLabel\?:\s*string/);
    expect(source).toMatch(/aria-label=\{ariaLabel\}/);
});
