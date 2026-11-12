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

/** 저장 뒤 화면이 머물 주소와, 다시 시작해야 하는지와, 다시 시작한 뒤 열 새 주소. */
export type AddressAfterSave = {
    stay: string;
    /** 관리 화면 포트나 TLS 를 바꿨다. 서버 프로그램을 다시 시작해야 반영된다. */
    restartRequired?: true;
    /** 다시 시작한 뒤 열 주소. stay 와 다를 때만 있다. 프록시로 연 화면은 새 주소도 프록시 주소라 없다. */
    restartTo?: string;
};

/**
 * 이슈 370 C-1: 관리 화면 포트·TLS 는 서버 프로그램을 다시 시작해야 바뀐다. 저장 뒤에는 지금 주소(stay)에 머문다.
 * 관리 화면 설정을 바꿨으면 restartRequired 를 붙이고, 다시 시작한 뒤 열 새 주소가 지금 주소와 다르면 restartTo 도 준다.
 */
export const adminAddressAfterSave = (page: PageLocation, before: {adminTls?: boolean; adminPort?: number},
                                      after: {adminTls?: boolean; adminPort?: number}, currentAdminPort: number | undefined): AddressAfterSave => {
    const stay = adminBaseUrl(page, before, currentAdminPort);
    const changed = before.adminPort !== after.adminPort || Boolean(before.adminTls) !== Boolean(after.adminTls);
    if(!changed) return {stay};
    const restartTo = adminBaseUrl(page, after, currentAdminPort);
    return restartTo === stay ? {stay, restartRequired: true} : {stay, restartRequired: true, restartTo};
};
