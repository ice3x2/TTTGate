import ServerOptionStore from "../ServerOptionStore";
import type {MfaPolicyOptions} from "../rbac/MfaPolicy";

/** 이슈 346: 2단계 인증 강제 판정에 넘길 서버 설정. 관리 서버의 모든 경로가 이 함수 하나로 읽는다. */
export const mfaPolicyOptions = (): MfaPolicyOptions => ({
    mfaRequiredForSuperusers: ServerOptionStore.instance.serverOption.mfaRequiredForSuperusers === true
});
