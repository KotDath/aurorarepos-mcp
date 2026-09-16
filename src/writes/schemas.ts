import { z } from 'zod';

const name = z.string().trim().min(1).max(200).refine((value) => [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) && !/[<>]/.test(value));
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const createInput = z.strictObject({ name });
export const renameInput = z.strictObject({ app_id: id, name });
export const approvalInput = z.strictObject({ confirm: z.boolean() });
export const output = z.strictObject({ operation: z.enum(['create_app', 'rename_my_app']), app_id: id,
  name, verified: z.literal(true), publication_requested: z.literal(false), release_created: z.literal(false) });
export type Operation = 'create_app' | 'rename_my_app';
export type Arguments = z.infer<typeof renameInput> | z.infer<typeof createInput>;
