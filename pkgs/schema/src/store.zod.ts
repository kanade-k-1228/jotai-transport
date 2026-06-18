import { z } from "zod";

export const storeSchema = z.object({
  count: z.number(),
  command: z.string(),
});
