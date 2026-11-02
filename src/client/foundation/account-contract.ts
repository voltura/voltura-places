import { z } from "zod";
import { displayNameSchema } from "../../shared/display-name";

export const accountIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9-]{1,80}$/)
  .refine((id) => id !== "guest");

export const accountStateSchema = z.object({
  enabled: z.boolean(),
  providers: z.object({
    google: z.boolean().optional(),
    email: z.boolean().optional(),
    chatgpt: z.boolean().optional(),
  }),
  account: z
    .object({
      id: accountIdSchema,
      displayName: displayNameSchema.optional(),
      methods: z.array(z.object({ provider: z.string(), label: z.string() })),
    })
    .nullable(),
});
export type AccountState = z.infer<typeof accountStateSchema>;
export type Account = NonNullable<AccountState["account"]>;
