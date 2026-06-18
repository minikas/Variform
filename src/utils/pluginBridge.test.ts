import { describe, it, expect, vi, afterEach } from "vitest";
import { sendRequest } from "./pluginBridge";
import { MessageTypes } from "../types.d";

/** Minimal window/parent stubs mimicking the Figma plugin iframe bridge. */
function setupBridge() {
  const listeners = new Set<(event: { data: unknown }) => void>();
  const sent: Array<{ pluginMessage: Record<string, unknown> }> = [];

  vi.stubGlobal("window", {
    addEventListener: (_type: string, handler: (event: { data: unknown }) => void) =>
      listeners.add(handler),
    removeEventListener: (_type: string, handler: (event: { data: unknown }) => void) =>
      listeners.delete(handler),
  });
  vi.stubGlobal("parent", {
    postMessage: (message: { pluginMessage: Record<string, unknown> }) => sent.push(message),
  });

  const emit = (pluginMessage: Record<string, unknown>) =>
    listeners.forEach((handler) => handler({ data: { pluginMessage } }));

  return { sent, emit, listenerCount: () => listeners.size };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendRequest", () => {
  it("posts the request with a requestId and resolves on the matching response", async () => {
    const { sent, emit, listenerCount } = setupBridge();

    const promise = sendRequest<{ storageValue: string }>(
      MessageTypes.STORAGE_GET,
      { storageKey: "k" },
      MessageTypes.STORAGE_VALUE,
    );

    expect(sent[0].pluginMessage).toMatchObject({
      type: MessageTypes.STORAGE_GET,
      storageKey: "k",
    });
    const { requestId } = sent[0].pluginMessage;
    expect(requestId).toBeTruthy();

    // A reply for a different request must be ignored.
    emit({ type: MessageTypes.STORAGE_VALUE, requestId: "someone-else", storageValue: "nope" });
    // The matching reply resolves the promise.
    emit({ type: MessageTypes.STORAGE_VALUE, requestId, storageValue: "yes" });

    await expect(promise).resolves.toMatchObject({ storageValue: "yes" });
    // Listener is cleaned up after resolving.
    expect(listenerCount()).toBe(0);
  });

  it("ignores responses of the wrong type", async () => {
    const { sent, emit } = setupBridge();
    const promise = sendRequest(MessageTypes.STORAGE_GET, {}, MessageTypes.STORAGE_VALUE, 50);
    const { requestId } = sent[0].pluginMessage;

    // Right id, wrong type → must not resolve; it should time out instead.
    emit({ type: MessageTypes.EXPORT_SUCCESS_RESULT, requestId, data: "x" });

    await expect(promise).rejects.toThrow(/timed out/i);
  });

  it("rejects on timeout and removes its listener", async () => {
    const { listenerCount } = setupBridge();
    await expect(
      sendRequest(MessageTypes.STORAGE_GET, {}, MessageTypes.STORAGE_VALUE, 5),
    ).rejects.toThrow(/timed out/i);
    expect(listenerCount()).toBe(0);
  });
});
