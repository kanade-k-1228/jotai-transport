import { transport } from './transport.ts';

export const countAtom = transport.atom('count');
export const commandAtom = transport.atom('command');
export const statusAtom = transport.statusAtom();
