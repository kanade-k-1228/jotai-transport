import { createTransportClient } from 'jotai-transport-client';
import type { Store } from '../store.ts';

const url = (port = 8137): string =>
  typeof location !== 'undefined' && location.hostname
    ? `ws://${location.hostname}:${port}`
    : `ws://localhost:${port}`;

export const transport = createTransportClient<Store>(url());
