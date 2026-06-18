import { createTransport } from 'jotai-transport';
import type { Store } from '../store.ts';

const url =
  typeof location !== 'undefined' && location.hostname
    ? `ws://${location.hostname}:8173`
    : `ws://localhost:8173`;

export const transport = createTransport<Store>({ url });
