import { Transport } from './state/transport';

export const transport = new Transport(
  typeof location !== 'undefined' && location.hostname
    ? `ws://${location.hostname}:8137`
    : 'ws://localhost:8137',
);
