import { createTransport } from 'jotai-transport';

export interface Store {
  red: boolean;
  yellow: boolean;
  green: boolean;
}

const transport = createTransport<Store>({ url: `ws://${location.host}/ws` });

export const statusAtom = transport.statusAtom();

export const redAtom =  transport.atom('red');
export const yellowAtom =  transport.atom('yellow');
export const greenAtom =  transport.atom('green');
