import { z } from "zod";

export const displayNameSchema = z
  .string()
  .transform((value) => value.normalize("NFC").trim())
  .refine((value) => Array.from(value).length <= 60)
  .refine((value) => !/[\p{Cc}\p{Cs}\p{Bidi_Control}\u2028\u2029]/u.test(value))
  .refine((value) => !value || /[^\s\p{Default_Ignorable_Code_Point}]/u.test(value))
  .transform((value) => value || null)
  .nullable();
