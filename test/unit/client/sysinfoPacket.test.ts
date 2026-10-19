import os from 'os';
import {CtrlPacket} from '../../../src/commons/CtrlPacket';
import {SysMonitor} from '../../../src/commons/SysMonitor';
import {sysinfoMessagePacket} from '../../../src/client/sysinfoPacket';

// #164 — sysinfo 전송 예외가 unhandled rejection 이 되어 클라이언트 프로세스가 끝나지 않게 한다.
describe('client sysinfo packet', () => {
    const base = {
        osInfo: {platform: 'linux', release: '6', type: 'Linux', hostname: 'node-1'},
        ram: 1024, cpuInfo: {model: 'x', speed: 1, cores: 1}
    };

    it('trims the network interface list so the packet fits the payload limit', () => {
        const network: Record<string, any[]> = {};
        for(let i = 0; i < 2000; i += 1) {
            network[`veth${i}`] = [{address: `10.0.${i % 255}.${i % 250}`, netmask: '255.255.255.0', family: 'IPv4', mac: '02:42:ac:11:00:02', internal: false, cidr: '10.0.0.1/24'}];
        }
        const packet = sysinfoMessagePacket(7, {...base, network} as any);
        const buffer = packet.toBuffer();
        const parsed = CtrlPacket.fromBuffer(buffer).packet!;
        const message = CtrlPacket.getMessageFromPacket(parsed);
        expect(message.type).toBe('sysinfo');
        const payload = message.payload as any;
        expect(payload.osInfo.hostname).toBe('node-1');
        expect(Object.keys(payload.network).length).toBeLessThan(2000);
    });

    it('keeps the full payload when it already fits', () => {
        const network = {eth0: [{address: '10.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: 'x', internal: false, cidr: ''}]};
        const message = CtrlPacket.getMessageFromPacket(CtrlPacket.fromBuffer(sysinfoMessagePacket(1, {...base, network} as any).toBuffer()).packet!);
        expect((message.payload as any).network).toEqual(network);
    });

    it('builds sysinfo even when os.cpus() is empty', async () => {
        const spy = jest.spyOn(os, 'cpus').mockReturnValue([]);
        try {
            (SysMonitor.instance as any)._sysInfoCache = undefined;
            const info = await SysMonitor.instance.sysInfo();
            expect(info.cpuInfo).toMatchObject({cores: 0});
        } finally {
            spy.mockRestore();
            (SysMonitor.instance as any)._sysInfoCache = undefined;
        }
    });
});
