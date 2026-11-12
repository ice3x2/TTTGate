// 이슈 369(설계 반영): 겹쳐 연 창의 순서. Esc 는 맨 위 창만 닫는다. 연결 창 위에 차단 확인 창을 띄운 경우에 필요하다.
const stack: symbol[] = [];

/** 창을 열 때 부른다. 돌려받은 표식으로 맨 위인지 묻고, 닫을 때 넘긴다. */
export function openModal(): symbol {
    const token = Symbol('modal');
    stack.push(token);
    return token;
}

export function closeModal(token: symbol): void {
    const index = stack.lastIndexOf(token);
    if(index >= 0) stack.splice(index, 1);
}

export function isTopModal(token: symbol): boolean {
    return stack.length > 0 && stack[stack.length - 1] === token;
}
