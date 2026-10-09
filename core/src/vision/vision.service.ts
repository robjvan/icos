import { Inject, Injectable } from '@nestjs/common';
import { LlmClient } from '../llm/llm.client';
import type { LlmContentPart } from '../llm/llm.client';

/** DI token for the vision role's own `LlmClient` instance (M17b.8). */
export const VISION_LLM_CLIENT = 'VISION_LLM_CLIENT';

export interface VisionAnalysis {
  text: string;
  model: string;
}

/**
 * M17b.8 vision role: an auxiliary image-capable model that answers
 * `vision_analyze` on behalf of a text-only chat model (or as a second
 * opinion). Reuses the generic `LlmClient` against the vision endpoint —
 * no provider-specific code — sending the image as an OpenAI-compatible
 * `image_url` data URL.
 */
@Injectable()
export class VisionService {
  constructor(@Inject(VISION_LLM_CLIENT) private readonly llm: LlmClient) {}

  async analyze(input: {
    dataUrl: string;
    prompt: string;
    sessionId?: string;
  }): Promise<VisionAnalysis> {
    const parts: LlmContentPart[] = [
      { type: 'text', text: input.prompt },
      { type: 'image_url', image_url: { url: input.dataUrl } },
    ];
    const { content, model } = await this.llm.chat({
      messages: [{ role: 'user', content: parts }],
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    });
    return { text: content, model };
  }
}
