import { z } from 'zod';
import { aiModelSchema } from '../ai/schema';

export const aiConfigurationSchema = z
  .object({
    model: aiModelSchema,
    allowRetries: z.boolean(),
  })
  .strict();
export type AIConfiguration = z.infer<typeof aiConfigurationSchema>;
export const DEFAULT_AI_CONFIGURATION: AIConfiguration = {
  model: 'gemini-3.5-flash-lite',
  allowRetries: false,
};
export const GEMINI_MODEL = DEFAULT_AI_CONFIGURATION.model;
export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com/*';
export const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
export const AI_OUTPUT_LIMIT = 48_000;

export function geminiEndpoint(model: unknown) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${aiModelSchema.parse(model)}:generateContent`;
}
