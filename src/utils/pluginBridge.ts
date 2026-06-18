import { MessageTypes } from "../types.d";

/**
 * Promise bridge over the Figma plugin postMessage channel.
 *
 * The UI iframe and the plugin sandbox talk via `postMessage`, which is
 * fire-and-forget. `sendRequest` posts a message tagged with a unique
 * `requestId` and resolves once the plugin replies with the matching response
 * type AND the same `requestId` — so concurrent requests of the same type never
 * cross. This lets message round-trips be wrapped in react-query useQuery /
 * useMutation. The plugin (code.ts) must echo `requestId` back on the response.
 */

let nextRequestId = 0;

const DEFAULT_TIMEOUT_MS = 10_000;

interface PluginResponse {
  type?: MessageTypes;
  requestId?: string;
  [key: string]: unknown;
}

export function sendRequest<TResponse = PluginResponse>(
  requestType: MessageTypes,
  payload: Record<string, unknown>,
  responseType: MessageTypes,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<TResponse> {
  const requestId = `${requestType}:${nextRequestId++}`;

  return new Promise<TResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error(`Plugin request "${requestType}" timed out.`));
    }, timeoutMs);

    function handler(event: MessageEvent) {
      const message = (event.data as { pluginMessage?: PluginResponse } | undefined)
        ?.pluginMessage;
      if (message?.type === responseType && message.requestId === requestId) {
        clearTimeout(timer);
        window.removeEventListener("message", handler);
        resolve(message as TResponse);
      }
    }

    window.addEventListener("message", handler);
    parent.postMessage(
      { pluginMessage: { ...payload, type: requestType, requestId } },
      "*",
    );
  });
}
