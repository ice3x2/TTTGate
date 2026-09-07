import forge from "node-forge";

const toHex = (buf: ArrayBuffer | Uint8Array): string => {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
};

export async function sha512Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    if (crypto.subtle) {
        return toHex(await crypto.subtle.digest('SHA-512', data));
    }
    // Explicit HTTP admin deployments lack SubtleCrypto. Preserve SHA-512
    // over the identical UTF-8 bytes using the existing forge dependency.
    const digest = forge.md.sha512.create();
    digest.update(forge.util.createBuffer(data).getBytes());
    return digest.digest().toHex();
}

export function randomHex(bytes = 32): string {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return toHex(buf);
}
