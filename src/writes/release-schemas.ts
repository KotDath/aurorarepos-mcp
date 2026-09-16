import { z } from 'zod';
import { prepareInput } from '../release/schemas.js';
import { rawApp, versionSchema } from '../developer/schemas.js';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(4000).refine((value) => !/[<>]/.test(value) && !value.includes(String.fromCharCode(0)));
const wallTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).refine((value) => {
  const date = new Date(`${value}:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 16) === value;
});
export const uploadInput = prepareInput.safeExtend({ app_id: id });
export const updateInput = z.strictObject({ app_id: id, version_id: id,
  description: text.optional(), category_id: id.optional(), release_notes: text.optional(),
}).refine((value) => value.description !== undefined || value.category_id !== undefined || value.release_notes !== undefined);
export const scheduleInput = z.strictObject({ app_id: id, version_id: id, is_delayed: z.boolean(), publish_at: wallTime.optional() })
  .refine((value) => value.is_delayed === (value.publish_at !== undefined));
const retained = z.string().max(2000).nullable();
const flag = z.union([z.literal('checked'), z.literal(''), z.null()]);
export const editorSchema = rawApp.extend({ category_id: id, description: z.string().max(200_000),
  system: z.number().int().min(1).max(3), site: retained, donate: retained, email: retained,
  icon: z.string().min(1).max(2000), validator: flag, notoff: flag,
  is_delayed: z.boolean(), publish_at: retained,
  screenshots: z.array(z.object({ src: z.string().min(1).max(2000), id: id.optional(), application_id: id.optional() })).max(10),
});
export const releaseWriteOutput = z.strictObject({ operation: z.enum(['upload_release', 'update_my_app_version', 'schedule_my_app_version']),
  app_id: id, version: versionSchema, verified: z.literal(true), uploaded: z.boolean(),
  shared_metadata_preserved: z.literal(true), publication_state: z.string().max(32),
  scheduling_timezone_verified: z.literal(false),
});
export type ReleaseOperation = 'upload_release' | 'update_my_app_version' | 'schedule_my_app_version';
export type ReleaseArguments = z.infer<typeof uploadInput> | z.infer<typeof updateInput> | z.infer<typeof scheduleInput>;
export type Editor = z.infer<typeof editorSchema>;
