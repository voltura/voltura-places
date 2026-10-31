import { z } from "zod";
export const familySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  ownerId: z.string(),
  invitationVersion: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
  members: z.array(z.object({ id: z.string(), label: z.string().max(320) })).max(10),
  requests: z
    .array(z.object({ id: z.string(), label: z.string().max(320) }))
    .max(5)
    .default([]),
});
export const familyStateSchema = z.object({
  families: z.array(familySchema).max(20),
  familyId: z.string().uuid().optional(),
  pendingRequest: z.object({ expiresAt: z.number() }).nullable().optional(),
});
export type Family = z.infer<typeof familySchema>;
export const familyKey = (account: string, family: string) => `family:${account}:${family}`;
export function workspaceIdentity(key: string) {
  const match = /^family:([A-Za-z0-9-]{1,80}):([0-9a-f-]{36})$/i.exec(key);
  return match ? { account: match[1], family: match[2] } : { account: key, family: null };
}
export const workspaceHeaders = (key: string) => {
  const identity = workspaceIdentity(key);
  return {
    "X-Places-Account": identity.account,
    ...(identity.family ? { "X-Places-Family": identity.family } : {}),
  };
};
