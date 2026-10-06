import { z } from 'zod';
export const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +919876543210');
export const registrationSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    phone,
    email: z.email().trim().toLowerCase().max(254),
    team_name: z.string().trim().min(1).max(100),
    college_name: z.string().trim().min(1).max(160),
    alternate_contact: phone,
  })
  .strict();
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const scanSchema = z.object({
  token: z
    .string()
    .transform((v) => v.replace(/^FARLANDS:/, ''))
    .pipe(tokenSchema),
  mode: z.enum(['auto', 'exit', 'return']),
  request_id: z.uuid(),
});
export type Registration = z.infer<typeof registrationSchema>;
