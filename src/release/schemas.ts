import { z } from 'zod';

const path = z.string().min(1).max(4096).refine((value) => [...value].every((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127));
export const prepareInput = z.strictObject({
  rpm32_path: path.optional(), rpm64_path: path.optional(),
  aurora_versions: z.array(z.union([z.literal(4), z.literal(5)])).min(1).max(2)
    .refine((values) => new Set(values).size === values.length),
  app_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  release_notes: z.string().max(4000).default(''),
}).refine((value) => value.rpm32_path !== undefined || value.rpm64_path !== undefined);

export const metadata = z.strictObject({
  name: z.string().min(1).max(200), version: z.string().min(1).max(80), release: z.string().min(1).max(80),
  epoch: z.number().int().nonnegative().max(0xffff_ffff),
  arch: z.enum(['armv7hl', 'aarch64']), os: z.literal('linux'),
  payload_format: z.literal('cpio'), payload_compressor: z.enum(['gzip', 'xz', 'zstd', 'bzip2', 'none']),
});
export const packagePreview = z.strictObject({
  slot: z.enum(['rpm32', 'rpm64']), filename: z.string().min(1).max(255),
  size_bytes: z.number().int().positive().max(256 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), metadata,
  signature_verified: z.literal(false), payload_verified: z.literal(false),
});
export const warningCodes = ['SIGNATURE_NOT_VERIFIED', 'EMBEDDED_DIGESTS_NOT_VERIFIED', 'PAYLOAD_NOT_DECOMPRESSED',
  'DEPENDENCIES_AND_SDK_COMPATIBILITY_NOT_VERIFIED', 'TARGET_APP_NOT_VERIFIED', 'PREVIEW_IS_NOT_UPLOAD_APPROVAL'] as const;
export const prepareOutput = z.strictObject({
  kind: z.literal('local_release_preview'), uploaded: z.literal(false), approval_granted: z.literal(false),
  target: z.strictObject({ app_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(), ownership_verified: z.literal(false),
    aurora_versions: z.array(z.union([z.literal(4), z.literal(5)])).min(1).max(2), compatibility_verified: z.literal(false) }),
  release_notes: z.string().max(4000), packages: z.array(packagePreview).min(1).max(2),
  warnings: z.array(z.enum(warningCodes)).length(warningCodes.length),
});
