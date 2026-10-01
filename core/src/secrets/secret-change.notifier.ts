import { Injectable } from '@nestjs/common';

/**
 * Signals that a vault secret changed (S3). Consumers (e.g. MCP
 * servers) that resolve `secret:NAME` at spawn time subscribe and
 * reconnect their dependents, so a rotated value is picked up and a
 * deleted value fails closed — never a stale, cached value. Kept tiny
 * and synchronous so the secrets layer stays decoupled from its
 * consumers.
 */
@Injectable()
export class SecretChangeNotifier {
  private readonly listeners = new Set<(reference: string) => void>();

  onChange(listener: (reference: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Notify listeners; a throwing listener never breaks the caller. */
  notify(reference: string): void {
    for (const listener of this.listeners) {
      try {
        listener(reference);
      } catch {
        // Observers never break the subject.
      }
    }
  }
}
