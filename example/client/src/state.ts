import { createTransport } from 'jotai-transport';

const transport = createTransport(`ws://${location.host}/ws`);

export const statusAtom = transport.statusAtom();

export const redAtom = transport.atom<boolean>('red');
export const yellowAtom = transport.atom<boolean>('yellow');
export const greenAtom = transport.atom<boolean>('green');
