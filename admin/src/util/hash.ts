const toHex = (buf: ArrayBuffer | Uint8Array): string => {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
        out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
};

export function randomHex(bytes = 32): string {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return toHex(buf);
}
