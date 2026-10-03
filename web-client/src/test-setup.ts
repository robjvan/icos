/**
 * Global Vitest setup for the web client (Angular unit-test builder).
 *
 * The test environment provides no usable `WebSocket`, so a component
 * that starts `RealtimeService` (e.g. `DashboardPage`) falls through to
 * Node's built-in socket and tries to open a real connection to
 * `ws://localhost:3000/core/events`. When a Core happens to be running,
 * undici's connection callback throws a cross-realm `Event` TypeError
 * that fails the run even though every test passes; when Core is down the
 * suite merely gets slower. Neither should decide the result.
 *
 * A no-op socket keeps the suite hermetic and off the network. Tests that
 * need socket behaviour stub their own (`realtime.service.spec.ts`).
 */
class NoopWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly readyState = NoopWebSocket.OPEN;

  addEventListener(): void {
    // Never opens a connection, so there is nothing to listen for.
  }

  removeEventListener(): void {
    // Symmetric with addEventListener.
  }

  send(): void {
    // Nothing is connected to send to.
  }

  close(): void {
    // Nothing to close.
  }
}

globalThis.WebSocket = NoopWebSocket as unknown as typeof WebSocket;
