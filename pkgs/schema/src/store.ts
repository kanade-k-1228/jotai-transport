export interface Store {
  count: number;
  command: string;
}

export const init: Store = {
  count: 0,
  command: '',
};
