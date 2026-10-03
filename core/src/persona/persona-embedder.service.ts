import { Injectable, Logger } from '@nestjs/common';
import { OnnxEmbedder } from 'ruvector';

/**
 * Embedding boundary for semantic drift (M15c). Kept abstract so the
 * detectors depend on an interface, not on RuVector: tests inject a
 * deterministic fake, and the real embedder fails closed — if the model
 * cannot load, `embed` returns `null` and semantic drift falls back to the
 * token-distribution triad rather than breaking.
 */
export abstract class PersonaEmbedder {
  abstract embed(text: string): Promise<number[] | null>;
}

@Injectable()
export class RuvectorPersonaEmbedder extends PersonaEmbedder {
  private readonly logger = new Logger(RuvectorPersonaEmbedder.name);
  private backend: Promise<OnnxEmbedder | null> | null = null;

  async embed(text: string): Promise<number[] | null> {
    const embedder = await this.ensure();
    if (!embedder) {
      return null;
    }
    try {
      const vector = await embedder.embedPassage(text);
      return Array.from(vector);
    } catch (error) {
      this.logger.warn(
        `Persona embed failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private ensure(): Promise<OnnxEmbedder | null> {
    if (!this.backend) {
      this.backend = this.init().catch((error: unknown) => {
        this.logger.warn(
          `Persona embedder disabled: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      });
    }
    return this.backend;
  }

  private async init(): Promise<OnnxEmbedder> {
    const embedder = new OnnxEmbedder();
    await embedder.init();
    return embedder;
  }
}
