// 이슈 389 FR-3: 저장 뒤 "지금은 켜진 채로 둡니다" 알림을 띄울지 정한다(순수 함수). 화면은 결과대로 알림만 띄운다.
// 서버는 리스너가 돌던 터널을 저장하면 지금 상태를 이어받고, inactiveOnStartup 은 다음 기동부터 쓴다.

/** 편집 화면이 상태 영역에서 받은 이 터널의 상태. online 은 리스너가 도는가, active 는 켜져 있는가다. */
export type StartupNoticeStatus = {online?: boolean; active?: boolean};

/**
 * 지금 켜진 터널에서 "서버 시작 시 꺼진 채로"를 꺼짐→켜짐으로 바꿔 저장했으면 true 다.
 * 리스너가 돌지 않던 터널은 저장하면 이 설정을 바로 따르므로 알리지 않는다. 상태를 모르면(새 터널 등) 알리지 않는다.
 */
export function showsStartupOffLater(loaded: boolean | undefined, saved: boolean | undefined,
                                     status: StartupNoticeStatus | undefined): boolean {
    return loaded !== true && saved === true && status?.online === true && status.active === true;
}
