import {BlockList, isIP} from "net";
import {BlocklistEntry, ConnectionSecurityOption} from "../../types/TunnelingOption";
import {ipv6Groups, normalizeRemoteAddress} from "./address";

/**
 * #286 — 관리자가 직접 관리하는 영구 차단 목록.
 * 주소 해석·목록 검증은 순수 함수이고, 연결 판정은 IpBlocklist 가 Node 내장 BlockList 로 한다.
 */

export const MAX_BLOCKLIST_ENTRIES = 1000;
export const MAX_BLOCKLIST_NOTE_LENGTH = 200;

const COVERS_EVERY_ADDRESS = 'a range that covers every address cannot be blocked';
const PREFIX_PATTERN = /^(0|[1-9]\d{0,2})$/;
/** 설정 파일의 틀린 항목은 메모리에서 빠지므로 다음 저장 때 파일에서도 빠진다. 경고가 그 사실을 알린다. */
const DROPPED = 'ignored and dropped at the next save';

type Parsed<T> = {ok: true} & T | {ok: false; message: string};

export type AddBlocklistRequest = {address?: unknown; port?: unknown; note?: unknown};
export type AddBlocklistResult =
    {ok: true; entry: BlocklistEntry; entries: BlocklistEntry[]; widenedFrom?: number} |
    {ok: false; code: 'invalid' | 'duplicate' | 'full'; message: string};

/**
 * 주소나 CIDR 대역을 정규화한다. IPv4-mapped 주소와 /96 이상의 그 대역은 표기(점·16진수)와 무관하게 IPv4 로,
 * IPv6 는 RFC 5952 압축형으로 쓰고, 대역은 호스트 비트를 지운 네트워크 주소로 쓴다. /32·/128 은 주소 하나로 쓴다.
 * 모든 주소를 덮는 /0 은 받지 않는다.
 */
export function parseBlockedAddress(input: unknown): Parsed<{address: string}> {
    if(typeof input !== 'string') return {ok: false, message: 'address must be a string'};
    const text = input.trim();
    const notAddress = {ok: false as const, message: `${text} is not an IP address or CIDR range`};
    const parts = text.split('/');
    if(parts.length > 2 || parts[0].includes('%')) return notAddress;
    const [host, prefixText] = parts;
    const family = isIP(host);
    if(family === 0) return notAddress;

    let bytes = family === 4 ? ipv4Bytes(host) : ipv6Groups(host)!.flatMap((group) => [group >> 8, group & 0xff]);
    let prefix = bytes.length * 8;
    if(prefixText !== undefined) {
        if(!PREFIX_PATTERN.test(prefixText) || Number(prefixText) > prefix) return notAddress;
        prefix = Number(prefixText);
    }
    if(isIpv4Mapped(bytes) && prefix >= 96) {
        bytes = bytes.slice(12);
        prefix -= 96;
    }
    if(prefix === 0) return {ok: false, message: COVERS_EVERY_ADDRESS};

    const bits = bytes.length * 8;
    const network = bytes.map((byte, i) => byte & maskByte(prefix - i * 8));
    const address = network.length === 4 ? network.join('.') : formatIpv6(network);
    return {ok: true, address: prefix === bits ? address : `${address}/${prefix}`};
}

/** addBlocklistEntry 의 문맥. tunnelPorts 는 지금 터널이 쓰는 외부 포트다. 포트를 고른 항목은 그중 하나여야 한다. */
export type AddBlocklistContext = {now: number; createdBy: string; tunnelPorts: ReadonlySet<number>; widen?: boolean};

/**
 * 새 항목을 검증해 붙인 새 목록을 돌려준다. 원래 목록은 바꾸지 않는다. 주소는 목록 안에서 유일하다.
 * 포트를 고른 항목은 그 포트를 쓰는 터널이 있어야 한다. 없는 터널에 건 항목은 나중에 그 포트로 만든 다른 터널에 걸린다.
 * widen 이면(일시 차단에서 옮길 때) 포트 하나에만 걸린 같은 주소를 그 자리에서 All tunnels 로 넓힌다(REQ-5 AC-1).
 * 넓힐 때는 적용 범위만 바꾸고, 원래 메모·시각·사용자는 그대로 둔다.
 */
export function addBlocklistEntry(entries: readonly BlocklistEntry[], request: AddBlocklistRequest, context: AddBlocklistContext): AddBlocklistResult {
    const address = parseBlockedAddress(request.address);
    if(!address.ok) return {ok: false, code: 'invalid', message: address.message};
    const port = parsePort(request.port);
    if(!port.ok) return {ok: false, code: 'invalid', message: port.message};
    if(port.port !== null && !context.tunnelPorts.has(port.port)) return {ok: false, code: 'invalid', message: `no tunnel uses port ${port.port}`};
    const note = parseNote(request.note);
    if(!note.ok) return {ok: false, code: 'invalid', message: note.message};
    const entry: BlocklistEntry = {address: address.address, port: port.port, note: note.note, createdAt: context.now, createdBy: context.createdBy};
    const existing = entries.find((candidate) => candidate.address === address.address);
    if(existing) {
        if(context.widen && existing.port !== null && entry.port === null) {
            const widened: BlocklistEntry = {...existing, port: null};
            return {ok: true, entry: widened, entries: entries.map((candidate) => candidate === existing ? widened : candidate), widenedFrom: existing.port};
        }
        const scope = existing.port === null ? 'all tunnels' : `port ${existing.port}`;
        return {ok: false, code: 'duplicate', message: `${address.address} is already blocked on ${scope}`};
    }
    if(entries.length >= MAX_BLOCKLIST_ENTRIES) {
        return {ok: false, code: 'full', message: `the blocklist already has ${MAX_BLOCKLIST_ENTRIES} entries`};
    }
    return {ok: true, entry, entries: [...entries, entry]};
}

/** 주소를 정규화해 같은 항목을 뺀 새 목록을 돌려준다. 없으면 removed 가 undefined 이고 목록은 그대로다. */
export function removeBlocklistEntry(entries: BlocklistEntry[], address: string): {removed: BlocklistEntry | undefined; entries: BlocklistEntry[]} {
    const parsed = parseBlockedAddress(address);
    const key = parsed.ok ? parsed.address : address;
    const removed = entries.find((entry) => entry.address === key);
    return removed ? {removed, entries: entries.filter((entry) => entry !== removed)} : {removed: undefined, entries};
}

/** 외부 포트를 바꾼 터널의 항목을 새 포트로 옮긴 새 목록. 포트를 고른 항목은 포트 번호가 아니라 터널을 따라간다. */
export function moveBlocklistPort(entries: readonly BlocklistEntry[], from: number, to: number): BlocklistEntry[] {
    return entries.map((entry) => entry.port === from ? {...entry, port: to} : entry);
}

/** 터널이 없는 포트에 건 항목을 빼고 경고를 돌려준다. 설정 파일을 손으로 고쳤거나 터널 목록을 통째로 바꾼 경우에 생긴다. */
export function dropOrphanBlocklistEntries(entries: BlocklistEntry[], tunnelPorts: ReadonlySet<number>): {entries: BlocklistEntry[]; warnings: string[]} {
    const orphans = entries.filter((entry) => entry.port !== null && !tunnelPorts.has(entry.port));
    if(orphans.length === 0) return {entries, warnings: []};
    return {
        entries: entries.filter((entry) => !orphans.includes(entry)),
        warnings: orphans.map((entry) => `connectionSecurity.blocklist: no tunnel uses port ${entry.port} for ${entry.address}; ${DROPPED}`)
    };
}

/**
 * port 에 건 항목을 alias 포트에도 건 설정. 터널의 외부 포트를 바꾸는 동안 옛 리스너가 멈출 때까지 쓴다.
 * 판정용 규칙에만 쓰고 저장하지 않는다(주소가 유일하다는 목록 규칙을 이 값은 지키지 않는다).
 */
export function withPortAlias(option: ConnectionSecurityOption | undefined, port: number, alias: number): ConnectionSecurityOption | undefined {
    if(!option) return option;
    const entries = option.blocklist ?? [];
    return {...option, blocklist: [...entries, ...entries.filter((entry) => entry.port === port).map((entry) => ({...entry, port: alias}))]};
}

/** 지운 터널의 항목을 뺀 새 목록. 남겨 두면 나중에 같은 포트를 쓰는 다른 터널에 걸린다. */
export function dropBlocklistPort(entries: readonly BlocklistEntry[], port: number): BlocklistEntry[] {
    return entries.filter((entry) => entry.port !== port);
}

/** 설정 파일에서 읽은 목록을 정규화한다. 틀린 항목은 서버 시작을 막지 않도록 건너뛰고 경고만 남긴다(REQ-2 AC-3). */
export function normalizeBlocklist(input: unknown): {entries: BlocklistEntry[]; warnings: string[]} {
    if(input === undefined || input === null) return {entries: [], warnings: []};
    if(!Array.isArray(input)) return {entries: [], warnings: [`connectionSecurity.blocklist must be an array; ${DROPPED}`]};
    const entries: BlocklistEntry[] = [];
    const warnings: string[] = [];
    let overflow = 0;
    input.forEach((raw: unknown, i) => {
        const label = `connectionSecurity.blocklist[${i}]`;
        if(typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            warnings.push(`${label} is not an object; ${DROPPED}`);
            return;
        }
        const source = raw as Record<string, unknown>;
        const address = parseBlockedAddress(source.address);
        if(!address.ok) {
            warnings.push(`${label}: ${address.message}; ${DROPPED}`);
            return;
        }
        const port = parsePort(source.port);
        if(!port.ok) {
            warnings.push(`${label}: ${port.message}; ${DROPPED}`);
            return;
        }
        if(entries.some((entry) => entry.address === address.address)) {
            warnings.push(`${label}: ${address.address} is listed twice; ${DROPPED}`);
            return;
        }
        if(entries.length >= MAX_BLOCKLIST_ENTRIES) {
            overflow++;
            return;
        }
        const note = typeof source.note === 'string' ? source.note.trim() : '';
        if(note.length > MAX_BLOCKLIST_NOTE_LENGTH) warnings.push(`${label}: note is longer than ${MAX_BLOCKLIST_NOTE_LENGTH} characters; truncated`);
        entries.push({
            address: address.address,
            port: port.port,
            note: note.slice(0, MAX_BLOCKLIST_NOTE_LENGTH),
            createdAt: typeof source.createdAt === 'number' && Number.isFinite(source.createdAt) ? source.createdAt : 0,
            createdBy: typeof source.createdBy === 'string' ? source.createdBy : ''
        });
    });
    if(overflow > 0) warnings.push(`connectionSecurity.blocklist has more than ${MAX_BLOCKLIST_ENTRIES} entries; ${overflow} ${DROPPED}`);
    return {entries, warnings};
}

type Family = 'ipv4' | 'ipv6';
/** 주소 종류별 규칙. Node 의 BlockList 는 IPv4 주소를 IPv6 규칙(IPv4-mapped 대역)과도 비교하므로 종류마다 따로 둔다. */
type FamilyRules = Record<Family, BlockList>;
type Rules = {all: FamilyRules; byPort: ReadonlyMap<number, FamilyRules>};

const newFamilyRules = (): FamilyRules => ({ipv4: new BlockList(), ipv6: new BlockList()});

/**
 * 터널 연결 판정용 차단 목록. 목록이 바뀌면 규칙을 새로 만들어 참조만 바꾼다. 판정은 락 없이 그 순간의 규칙을 읽는다.
 * 넣는 항목은 normalizeBlocklist·addBlocklistEntry 를 거친 정규화된 값이다. IPv4 주소는 IPv4 규칙과만, IPv6 는 IPv6 규칙과만 비교한다.
 */
export class IpBlocklist {
    private _rules: Rules | undefined;

    public configure(entries: readonly BlocklistEntry[]): void {
        if(entries.length === 0) {
            this._rules = undefined;
            return;
        }
        const all = newFamilyRules();
        const byPort = new Map<number, FamilyRules>();
        for(const entry of entries) {
            let target = all;
            if(entry.port !== null) {
                target = byPort.get(entry.port) ?? newFamilyRules();
                byPort.set(entry.port, target);
            }
            const [network, prefix] = entry.address.split('/');
            const type = familyOf(network);
            if(type === undefined) continue;
            if(prefix === undefined) target[type].addAddress(network, type);
            else target[type].addSubnet(network, Number(prefix), type);
        }
        this._rules = {all, byPort};
    }

    public isBlocked(port: number, ip: string): boolean {
        const rules = this._rules;
        if(!rules) return false;
        const address = normalizeRemoteAddress(ip);
        const type = familyOf(address);
        if(type === undefined) return false;
        return rules.all[type].check(address, type) || (rules.byPort.get(port)?.[type].check(address, type) ?? false);
    }
}

function familyOf(address: string): Family | undefined {
    const family = isIP(address);
    return family === 4 ? 'ipv4' : family === 6 ? 'ipv6' : undefined;
}

/** 1–65535 의 정수 포트인지 본다. */
export function isPortNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function parsePort(value: unknown): Parsed<{port: number | null}> {
    if(value === undefined || value === null) return {ok: true, port: null};
    if(!isPortNumber(value)) {
        return {ok: false, message: 'port must be an integer between 1 and 65535'};
    }
    return {ok: true, port: value};
}

function parseNote(value: unknown): Parsed<{note: string}> {
    if(value === undefined || value === null) return {ok: true, note: ''};
    if(typeof value !== 'string') return {ok: false, message: 'note must be a string'};
    const note = value.trim();
    if(note.length > MAX_BLOCKLIST_NOTE_LENGTH) return {ok: false, message: `note must be at most ${MAX_BLOCKLIST_NOTE_LENGTH} characters`};
    return {ok: true, note};
}

/** prefix 중 이 바이트에 남는 비트 수(bitsLeft)로 마스크를 만든다. */
function maskByte(bitsLeft: number): number {
    if(bitsLeft >= 8) return 0xff;
    if(bitsLeft <= 0) return 0;
    return (0xff << (8 - bitsLeft)) & 0xff;
}

/** ::ffff:0:0/96 안의 주소인지 본다. */
function isIpv4Mapped(bytes: number[]): boolean {
    return bytes.length === 16 && bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
}

function ipv4Bytes(text: string): number[] {
    return text.split('.').map(Number);
}


/** RFC 5952: 소문자, 앞자리 0 생략, 가장 긴(같으면 앞의) 두 개 이상 연속한 0 그룹을 :: 로 줄인다. */
function formatIpv6(bytes: number[]): string {
    const groups = Array.from({length: 8}, (_, i) => (bytes[i * 2] << 8) | bytes[i * 2 + 1]);
    let bestStart = -1;
    let bestLength = 1;
    for(let i = 0; i < 8;) {
        if(groups[i] !== 0) { i++; continue; }
        let end = i;
        while(end < 8 && groups[end] === 0) end++;
        if(end - i > bestLength) { bestStart = i; bestLength = end - i; }
        i = end;
    }
    const hex = groups.map((group) => group.toString(16));
    if(bestStart < 0) return hex.join(':');
    return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}
