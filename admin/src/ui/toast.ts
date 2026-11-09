import {writable} from 'svelte/store';
import type {Tone} from './tone';

/** 이슈 338: 알림의 동작 버튼(예: Undo). 누르면 run 을 부르고 알림을 닫는다. */
export type ToastAction = {label: string; run: () => void};
export type ToastItem = {id: number; tone: Tone; message: string; action?: ToastAction; key?: string};

const MAX_TOASTS = 3;
const DEFAULT_TIMEOUT_MS = 4000;

const store = writable<ToastItem[]>([]);
export const toasts = {subscribe: store.subscribe};

let nextId = 1;

export const toast = {
    /** key 를 주면 같은 key 의 앞 알림을 지우고 대신한다(되돌리기 알림을 하나만 두는 데 쓴다). */
    push(input: {tone: Tone; message: string; timeoutMs?: number; action?: ToastAction; key?: string}): number {
        const id = nextId++;
        const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        store.update((items) => {
            const kept = input.key === undefined ? items : items.filter((item) => item.key !== input.key);
            const next = [...kept, {id, tone: input.tone, message: input.message, action: input.action, key: input.key}];
            return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
        });
        if(timeoutMs > 0) setTimeout(() => toast.dismiss(id), timeoutMs);
        return id;
    },
    dismiss(id: number): void {
        store.update((items) => items.filter((item) => item.id !== id));
    },
};
