type PageLocation = {protocol: string; hostname: string; port: string; origin: string};

/**
 * #303: 관리 서버 주소(끝에 / 포함). 페이지 포트가 지금 관리 포트와 다르면 역방향 프록시를 거쳐 연 것이므로
 * 페이지와 같은 출처를 쓴다. 관리 포트로 바로 열었으면 저장한 설정(adminTls·adminPort)을 따라간다.
 */
export const adminBaseUrl = (page: PageLocation, option: {adminTls?: boolean; adminPort?: number}, currentAdminPort: number | undefined): string => {
    const pagePort = page.port || (page.protocol === 'https:' ? '443' : '80');
    if(pagePort !== String(currentAdminPort)) return `${page.origin}/`;
    return `${option.adminTls ? 'https' : 'http'}://${page.hostname}:${option.adminPort}/`;
};

/**
 * 이슈 370 C-1: 관리 화면 포트·TLS 는 서버 프로그램을 다시 시작해야 바뀐다. 저장 뒤에는 지금 주소(stay)에 머문다.
 * 관리 화면 설정을 바꿨으면 다시 시작한 뒤 열 새 주소(restartTo)도 돌려준다.
 */
export const adminAddressAfterSave = (page: PageLocation, before: {adminTls?: boolean; adminPort?: number},
                                      after: {adminTls?: boolean; adminPort?: number}, currentAdminPort: number | undefined): {stay: string; restartTo?: string} => {
    const stay = adminBaseUrl(page, before, currentAdminPort);
    const changed = before.adminPort !== after.adminPort || Boolean(before.adminTls) !== Boolean(after.adminTls);
    return changed ? {stay, restartTo: adminBaseUrl(page, after, currentAdminPort)} : {stay};
};
