import { z } from "zod";
import {
  MAX_ADJUSTMENT,
  MAX_SCORE,
  MIN_SCORE,
  NAME_MAX_LENGTH,
  REASON_MAX_LENGTH,
} from "./constants";

// Disallow control characters (incl. newlines) in names and reasons.
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;

export const memberNameSchema = z
  .string({ error: "Name is required." })
  .trim()
  .min(1, "Name is required.")
  .max(NAME_MAX_LENGTH, `Name must be ${NAME_MAX_LENGTH} characters or fewer.`)
  .regex(NO_CONTROL_CHARS, "Name contains invalid characters.");

const reasonSchema = z
  .string()
  .trim()
  .max(REASON_MAX_LENGTH, `Reason must be ${REASON_MAX_LENGTH} characters or fewer.`)
  .regex(NO_CONTROL_CHARS, "Reason contains invalid characters.")
  .optional();

const versionSchema = z.number().int().positive();

export const scoreSchema = z
  .number({ error: "Enter a whole number." })
  .int("Points must be a whole number.")
  .min(MIN_SCORE, `Points cannot go below ${MIN_SCORE}.`)
  .max(MAX_SCORE, `Points cannot exceed ${MAX_SCORE.toLocaleString("en-US")}.`);

export const deltaSchema = z
  .number({ error: "Enter a whole number." })
  .int("Adjustment must be a whole number.")
  .min(-MAX_ADJUSTMENT, `Adjustment cannot be less than -${MAX_ADJUSTMENT.toLocaleString("en-US")}.`)
  .max(MAX_ADJUSTMENT, `Adjustment cannot exceed ${MAX_ADJUSTMENT.toLocaleString("en-US")}.`)
  .refine((v) => v !== 0, "Adjustment cannot be zero.");

export const createMemberSchema = z.object({
  name: memberNameSchema,
  initialScore: scoreSchema.optional().default(0),
});

export const updateMemberSchema = z
  .object({
    name: memberNameSchema.optional(),
    status: z.enum(["active", "inactive"]).optional(),
    expectedVersion: versionSchema,
  })
  .refine((v) => v.name !== undefined || v.status !== undefined, "Nothing to update.");

export const pointsChangeSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("adjust"),
    delta: deltaSchema,
    reason: reasonSchema,
    expectedVersion: versionSchema,
    confirmed: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal("set"),
    score: scoreSchema,
    reason: reasonSchema,
    expectedVersion: versionSchema,
    confirmed: z.boolean().optional(),
  }),
]);

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: z.string().min(1).max(256),
});

const pointButton = z.number().int().min(-MAX_ADJUSTMENT).max(MAX_ADJUSTMENT);
export const pointSettingsSchema = z
  .object({ btn1: pointButton, btn2: pointButton, btn3: pointButton, btn4: pointButton })
  .strict();

export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type PointsChangeInput = z.infer<typeof pointsChangeSchema>;
export type PointSettings = z.infer<typeof pointSettingsSchema>;

/** First human-readable message from a zod error. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}
