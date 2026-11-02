import { z } from "zod";

export const accountStateSchema = z.object({
  enabled: z.boolean(),
  providers: z.object({
    google: z.boolean().optional(),
    email: z.boolean().optional(),
    chatgpt: z.boolean().optional(),
  }),
  account: z
    .object({
      id: z.string(),
      methods: z.array(z.object({ provider: z.string(), label: z.string() })),
    })
    .nullable(),
});
export type AccountState = z.infer<typeof accountStateSchema>;
export type Account = NonNullable<AccountState["account"]>;
