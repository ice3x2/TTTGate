import {CtrlPacket} from "../commons/CtrlPacket";
import {SysInfo} from "../commons/SysMonitor";

/** CtrlPacket 의 순수 페이로드 한도(CtrlPacket.MAX_PAYLOAD_SIZE)보다 조금 작게 잡는다. JSON 래퍼 몫이다. */
const PAYLOAD_BUDGET = 60_000;

/**
 * sysinfo 메시지 패킷. 인터페이스·주소가 많은 호스트(컨테이너 노드 등)에서는 JSON 이 페이로드 한도를 넘어
 * toBuffer 가 RangeError 를 던지고, 클라이언트가 접속할 때마다 죽었다(#164). 넘치면 네트워크 인터페이스 목록을
 * 앞에서부터 들어가는 만큼만 남긴다.
 */
export function sysinfoMessagePacket(id: number, info: SysInfo): CtrlPacket {
    const message = (payload: SysInfo) => ({type: 'sysinfo', payload});
    if(Buffer.byteLength(JSON.stringify(message(info))) <= PAYLOAD_BUDGET) {
        return CtrlPacket.message(id, message(info));
    }
    const network: SysInfo['network'] = {};
    let size = Buffer.byteLength(JSON.stringify(message({...info, network: {}})));
    for(const [name, addresses] of Object.entries(info.network ?? {})) {
        const entry = Buffer.byteLength(JSON.stringify({[name]: addresses}));
        if(size + entry > PAYLOAD_BUDGET) break;
        network[name] = addresses;
        size += entry;
    }
    return CtrlPacket.message(id, message({...info, network}));
}
