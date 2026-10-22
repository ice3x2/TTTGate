import fs from "node:fs";
import path from "node:path";
import {peerFingerprint256} from "../../../helpers/tlsProbe";

// Existing equivalent helpers are private to test modules; importing those would
// register unrelated suites. Share these real-I/O observations between review REDs.
export const configurationFiles = (root: string): Record<string, string> => {
    const result: Record<string, string> = {};
    const visit = (directory: string) => {
        for(const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const file = path.join(directory, entry.name);
            if(entry.isDirectory()) visit(file);
            else result[file] = fs.readFileSync(file).toString("base64");
        }
    };
    visit(path.join(root, "config")); visit(path.join(root, "cert"));
    return result;
};

// 핸드셰이크 직후 리셋과 부하를 견디는 공용 탐침(#181).
export const peerFingerprint = (port: number) => peerFingerprint256(port);
