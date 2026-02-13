export type ServerEventType = "server:start" | "server:stop" | "server:crash" | "ram:high";

export type ServerEventPayload = {
  serverName: string;
  ip: string;
  port: number;
  ramPercent?: number;
};

type Handler = (payload: ServerEventPayload) => void;

const listeners: Record<ServerEventType, Set<Handler>> = {
  "server:start": new Set(),
  "server:stop": new Set(),
  "server:crash": new Set(),
  "ram:high": new Set()
};

export function emitEvent(type: ServerEventType, payload: ServerEventPayload) {
  listeners[type].forEach((handler) => handler(payload));
}

export function onEvent(type: ServerEventType, handler: Handler) {
  listeners[type].add(handler);
  return () => listeners[type].delete(handler);
}
