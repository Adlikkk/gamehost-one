import { useEffect, useMemo, useState } from "react";
import * as Switch from "@radix-ui/react-switch";
import type { ServerMeta } from "../types";
import { SettingRow } from "./ui/SettingRow";
import { SubtleButton } from "./ui/Buttons";
import {
  DEFAULT_DISCORD_TEMPLATES,
  sendDiscordWebhook,
  validateDiscordWebhookUrl
} from "../services/webhookService";

const TEMPLATE_HELP = "Use {serverName}, {ip}, {port}, {ramPercent}.";

export function DiscordSettings({
  meta,
  serverName,
  onChange,
  onNotify
}: {
  meta: ServerMeta;
  serverName: string;
  onChange: (patch: Partial<ServerMeta>) => void;
  onNotify: (tone: "success" | "error", message: string) => void;
}) {
  const [urlDraft, setUrlDraft] = useState(meta.discord_webhook_url ?? "");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const [templateStart, setTemplateStart] = useState(meta.discord_template_start);
  const [templateStop, setTemplateStop] = useState(meta.discord_template_stop);
  const [templateCrash, setTemplateCrash] = useState(meta.discord_template_crash);
  const [templateRam, setTemplateRam] = useState(meta.discord_template_ram);

  useEffect(() => {
    setUrlDraft(meta.discord_webhook_url ?? "");
  }, [meta.discord_webhook_url]);

  useEffect(() => {
    setTemplateStart(meta.discord_template_start);
    setTemplateStop(meta.discord_template_stop);
    setTemplateCrash(meta.discord_template_crash);
    setTemplateRam(meta.discord_template_ram);
  }, [
    meta.discord_template_start,
    meta.discord_template_stop,
    meta.discord_template_crash,
    meta.discord_template_ram
  ]);

  const isUrlValid = useMemo(() => !validateDiscordWebhookUrl(urlDraft), [urlDraft]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const trimmed = urlDraft.trim();
      const error = validateDiscordWebhookUrl(trimmed);
      setUrlError(error);
      if (error) return;
      onChange({ discord_webhook_url: trimmed ? trimmed : null });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [urlDraft, onChange]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      onChange({
        discord_template_start: templateStart || DEFAULT_DISCORD_TEMPLATES.start,
        discord_template_stop: templateStop || DEFAULT_DISCORD_TEMPLATES.stop,
        discord_template_crash: templateCrash || DEFAULT_DISCORD_TEMPLATES.crash,
        discord_template_ram: templateRam || DEFAULT_DISCORD_TEMPLATES.ram
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [templateStart, templateStop, templateCrash, templateRam, onChange]);

  const handleTest = async () => {
    const trimmed = urlDraft.trim();
    const error = validateDiscordWebhookUrl(trimmed);
    setUrlError(error);
    if (error || !trimmed) {
      onNotify("error", error ?? "Webhook URL is required.");
      return;
    }

    setTesting(true);
    try {
      await sendDiscordWebhook(trimmed, `✅ Discord webhook connected for ${serverName}.`);
      onNotify("success", "Webhook test sent.");
    } catch (err) {
      onNotify("error", String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label className="text-xs uppercase tracking-[0.2em] text-muted">Webhook URL</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
          />
          <SubtleButton onClick={handleTest} disabled={!isUrlValid || testing}>
            {testing ? "Testing..." : "Test connection"}
          </SubtleButton>
        </div>
        {urlError && <p className="text-xs text-danger">{urlError}</p>}
      </div>

      <div className="grid gap-3">
        <SettingRow label="Send message on server start">
          <Switch.Root
            checked={meta.discord_notify_start}
            onCheckedChange={(value) => onChange({ discord_notify_start: value })}
            className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
          >
            <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
          </Switch.Root>
        </SettingRow>
        <SettingRow label="Send message on server stop">
          <Switch.Root
            checked={meta.discord_notify_stop}
            onCheckedChange={(value) => onChange({ discord_notify_stop: value })}
            className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
          >
            <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
          </Switch.Root>
        </SettingRow>
        <SettingRow label="Send message on crash">
          <Switch.Root
            checked={meta.discord_notify_crash}
            onCheckedChange={(value) => onChange({ discord_notify_crash: value })}
            className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
          >
            <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
          </Switch.Root>
        </SettingRow>
        <SettingRow label="Send message when RAM > 95%">
          <Switch.Root
            checked={meta.discord_notify_ram}
            onCheckedChange={(value) => onChange({ discord_notify_ram: value })}
            className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
          >
            <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
          </Switch.Root>
        </SettingRow>
      </div>

      <div className="grid gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Message templates</p>
          <p className="mt-1 text-xs text-muted">{TEMPLATE_HELP}</p>
        </div>
        <div className="grid gap-2">
          <label className="text-xs uppercase tracking-[0.2em] text-muted">Server start</label>
          <textarea
            value={templateStart}
            onChange={(event) => setTemplateStart(event.target.value)}
            rows={2}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
          />
        </div>
        <div className="grid gap-2">
          <label className="text-xs uppercase tracking-[0.2em] text-muted">Server stop</label>
          <textarea
            value={templateStop}
            onChange={(event) => setTemplateStop(event.target.value)}
            rows={2}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
          />
        </div>
        <div className="grid gap-2">
          <label className="text-xs uppercase tracking-[0.2em] text-muted">Crash</label>
          <textarea
            value={templateCrash}
            onChange={(event) => setTemplateCrash(event.target.value)}
            rows={2}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
          />
        </div>
        <div className="grid gap-2">
          <label className="text-xs uppercase tracking-[0.2em] text-muted">RAM warning</label>
          <textarea
            value={templateRam}
            onChange={(event) => setTemplateRam(event.target.value)}
            rows={2}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}
