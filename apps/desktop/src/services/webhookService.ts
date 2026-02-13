import type { ServerEventPayload, ServerEventType } from "./eventBus";

export type DiscordWebhookConfig = {
  url: string | null;
  notifyStart: boolean;
  notifyStop: boolean;
  notifyCrash: boolean;
  notifyRam: boolean;
  templateStart: string;
  templateStop: string;
  templateCrash: string;
  templateRam: string;
};

export const DEFAULT_DISCORD_TEMPLATES = {
  start: "🎮 {serverName} is now online! Join now: {ip}:{port}",
  stop: "🛑 {serverName} has stopped.",
  crash: "💥 {serverName} crashed. Check logs.",
  ram: "⚠ {serverName} RAM usage is critical."
};

const DISCORD_WEBHOOK_REGEX = /^https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i;

export function validateDiscordWebhookUrl(url: string) {
  if (!url.trim()) return null;
  if (!DISCORD_WEBHOOK_REGEX.test(url.trim())) {
    return "Enter a valid Discord webhook URL.";
  }
  return null;
}

export function formatDiscordTemplate(template: string, payload: ServerEventPayload) {
  return template
    .replace(/\{serverName\}/g, payload.serverName)
    .replace(/\{ip\}/g, payload.ip)
    .replace(/\{port\}/g, String(payload.port))
    .replace(/\{ramPercent\}/g, payload.ramPercent !== undefined ? String(payload.ramPercent) : "");
}

export async function sendDiscordWebhook(url: string, content: string, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Webhook failed (${response.status})`);
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function sendDiscordNotification(
  eventType: ServerEventType,
  payload: ServerEventPayload,
  config: DiscordWebhookConfig
) {
  if (!config.url) return;

  if (eventType === "server:start" && !config.notifyStart) return;
  if (eventType === "server:stop" && !config.notifyStop) return;
  if (eventType === "server:crash" && !config.notifyCrash) return;
  if (eventType === "ram:high" && !config.notifyRam) return;

  const template =
    eventType === "server:start"
      ? config.templateStart
      : eventType === "server:stop"
      ? config.templateStop
      : eventType === "server:crash"
      ? config.templateCrash
      : config.templateRam;

  const content = formatDiscordTemplate(template, payload);
  if (!content.trim()) return;
  await sendDiscordWebhook(config.url, content);
}
