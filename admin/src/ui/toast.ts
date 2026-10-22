import {writable} from 'svelte/store';
import type {Tone} from './tone';

export type ToastItem = {id: number; tone: Tone; message: string};

const MAX_TOASTS = 3;
const DEFAULT_TIMEOUT_MS = 4000;

const store = writable<ToastItem[]>([]);
export const toasts = {subscribe: store.subscribe};

let nextId = 1;

export const toast = {
    push(input: {tone: Tone; message: string; timeoutMs?: number}): number {
        const id = nextId++;
        const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        store.update((items) => {
            const next = [...items, {id, tone: input.tone, message: input.message}];
            return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
        });
        if(timeoutMs > 0) setTimeout(() => toast.dismiss(id), timeoutMs);
        return id;
    },
    dismiss(id: number): void {
        store.update((items) => items.filter((item) => item.id !== id));
    },
};
