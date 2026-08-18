import type { Attachment } from '@plif/core';

/**
 * Keep images in the loop context for `inspect_image`, but never put them on a
 * text-only primary model request. Direct image input is allowed only after an
 * explicit `modalities: ["text", "image"]` declaration.
 */
export function attachmentsForPrimaryModel(
  attachments: readonly Attachment[],
  supportsImages: boolean,
): readonly Attachment[] {
  if (supportsImages) return attachments;
  return attachments.filter((attachment) => attachment.kind !== 'image');
}

export function hasImageAttachments(attachments: readonly Attachment[]): boolean {
  return attachments.some((attachment) => attachment.kind === 'image');
}
