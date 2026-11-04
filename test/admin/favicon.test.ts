import * as fs from "fs";
import * as path from "path";

// #321: 관리 화면은 붉은 터널 아이콘을 파비콘으로 낸다. SVG 를 우선 쓰고, SVG 를 못 쓰는 브라우저를 위해 .ico 를 둔다.
const admin = path.resolve(__dirname, "../../admin");

describe("console favicon (#321)", () => {
    test("index.html points to the SVG and ICO favicons", () => {
        const html = fs.readFileSync(path.join(admin, "index.html"), "utf8");
        expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any" />');
        expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
        expect(html).not.toContain("vite.svg");
    });

    test("both favicon files are in admin/public, so Vite copies them to the web root", () => {
        const svg = fs.readFileSync(path.join(admin, "public", "favicon.svg"), "utf8");
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg).toContain('viewBox="0 0 512 512"');
        const ico = fs.readFileSync(path.join(admin, "public", "favicon.ico"));
        // ICO 머리: 예약 0, 형식 1(아이콘), 그다음 이미지 수
        expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 7]);
    });
});
