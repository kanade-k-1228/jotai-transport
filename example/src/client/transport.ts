import { createTransport } from 'jotai-transport';
import type { Store } from '../store.ts';

const url =
  typeof location !== 'undefined' && location.hostname
    ? `ws://${location.hostname}:8137`
    : `ws://localhost:8137`;

export const transport = createTransport<Store>({ url });
