import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";

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

export const peerFingerprint = (port: number) => new Promise<string>((resolve, reject) => {
    const socket = tls.connect({host: "127.0.0.1", port, rejectUnauthorized: false});
    socket.setTimeout(3000, () => socket.destroy(new Error("TLS identity probe timed out")));
    socket.once("secureConnect", () => {
        const value = socket.getPeerCertificate().fingerprint256;
        socket.destroy(); resolve(value);
    });
    socket.once("error", error => { socket.destroy(); reject(error); });
});
