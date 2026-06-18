import type { TransportSchema } from 'transport-server';

export type Store = Record<string, number>;

export const makeInit = (keyCount: number): Store => {
  const init: Store = {};
  for (let i = 0; i < keyCount; i++) init[`k${i}`] = 0;
  return init;
};

export const keyNames = (init: Store): string[] => Object.keys(init);

export const makeSchema = (init: Store): TransportSchema<Store> => ({
  partial() {
    return {
      safeParse(value: unknown) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return { success: false as const };
        }
        const data: Partial<Store> = {};
        const record = value as Record<string, unknown>;
        for (const k of Object.keys(record)) {
          if (k in init && typeof record[k] === 'number') data[k] = record[k] as number;
        }
        return { success: true as const, data };
      },
    };
  },
});
