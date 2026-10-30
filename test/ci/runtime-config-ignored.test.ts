import {execFileSync} from "child_process";

// #264 REQ-2 — 실행 중 생기는 설정·상태 파일은 git 이 무시하고, 샘플과 README 는 계속 추적한다.
const ignored = (file: string): boolean => {
    try {
        execFileSync("git", ["check-ignore", "-q", "--no-index", file], {cwd: process.cwd(), windowsHide: true});
        return true;
    } catch(error: any) {
        // exit 1 은 "무시 안 됨" 이다. git 이 없거나 저장소가 아니면(128) 판정하지 말고 실패시킨다.
        if(error.status === 1) return false;
        throw error;
    }
};

describe("runtime config files are ignored by git (#264)", () => {
    test.each(["config/identity.yaml", "config/server.yaml", "config/client.yaml", "config/.server.state.json",
        "config/.key", "config/.bootstrap-token", "config/identity.yaml.bak"])("%s is ignored", (file) => {
        expect(ignored(file)).toBe(true);
    });

    test.each(["config/README.md", "config/server.sample.yaml", "config/client.sample.yaml"])("%s stays tracked", (file) => {
        expect(ignored(file)).toBe(false);
    });
});
