import { useEffect, useMemo, useState, type DragEvent } from "react";
import * as Switch from "@radix-ui/react-switch";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  ModsImportPayload,
  ModsValidationResult,
  ServerConfig,
  WorldImportPayload,
  WorldValidationResult
} from "../types";
import { classNames } from "../utils/classNames";
import { getWorldSourceKind } from "../utils/zipExtractor";
import { Card } from "../components/ui/Card";
import { PrimaryButton, SubtleButton } from "../components/ui/Buttons";
import { pickAndValidateWorld, buildWorldImportPayload } from "../services/worldImport";
import { pickAndValidateMods } from "../services/modImport";
import { validateModsSource } from "../services/modValidator";
import { compareWorldMods } from "../services/modComparator";
import {
  detectWorldProfile,
  getMigrationInstructions,
  suggestRamGb,
  type MigrationHost
} from "../services/migrationService";

export type MigrationCreatePayload = {
  name: string;
  serverType: ServerConfig["server_type"];
  version: string;
  ramGb: number;
  onlineMode: boolean;
  worldImport: WorldImportPayload;
  modImport?: ModsImportPayload | null;
};

export function MigrationWizard({
  systemRamGb,
  safeRamMaxGb,
  recommendedRamGb,
  onBack,
  onCreate
}: {
  systemRamGb: number | null;
  safeRamMaxGb: number;
  recommendedRamGb: number | null;
  onBack: () => void;
  onCreate: (payload: MigrationCreatePayload) => Promise<void>;
}) {
  const steps = [
    "Hosting",
    "Instructions",
    "World ZIP",
    "Detection",
    "Configure",
    "Summary"
  ];

  const [step, setStep] = useState(0);
  const [host, setHost] = useState<MigrationHost | null>(null);
  const [worldSourcePath, setWorldSourcePath] = useState<string | null>(null);
  const [worldValidation, setWorldValidation] = useState<WorldValidationResult | null>(null);
  const [worldError, setWorldError] = useState<string | null>(null);
  const [worldBusy, setWorldBusy] = useState(false);
  const [modsValidation, setModsValidation] = useState<ModsValidationResult | null>(null);
  const [modsError, setModsError] = useState<string | null>(null);
  const [modsBusy, setModsBusy] = useState(false);
  const [serverName, setServerName] = useState("Migrated World");
  const [serverType, setServerType] = useState<ServerConfig["server_type"]>("vanilla");
  const [serverVersion, setServerVersion] = useState("1.20.6");
  const [serverRam, setServerRam] = useState(4);
  const [ramAuto, setRamAuto] = useState(true);
  const [onlineMode, setOnlineMode] = useState(true);
  const [configTouched, setConfigTouched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const instructions = useMemo(() => getMigrationInstructions(host), [host]);
  const detection = useMemo(() => detectWorldProfile(worldValidation), [worldValidation]);
  const modComparison = useMemo(
    () => compareWorldMods(worldValidation, modsValidation),
    [worldValidation, modsValidation]
  );
  const recommended = useMemo(
    () => suggestRamGb(systemRamGb, safeRamMaxGb, worldValidation, modsValidation) ?? recommendedRamGb,
    [systemRamGb, safeRamMaxGb, worldValidation, modsValidation, recommendedRamGb]
  );

  useEffect(() => {
    if (!worldValidation?.valid) return;
    if (!configTouched) {
      const nextName = worldValidation.world_name?.trim() || "Migrated World";
      const nextDetection = detectWorldProfile(worldValidation);
      setServerName(nextName);
      if (nextDetection) {
        setServerType(nextDetection.loader);
        if (nextDetection.version) {
          setServerVersion(nextDetection.version);
        }
      }
    }
  }, [worldValidation, configTouched]);

  useEffect(() => {
    if (!ramAuto || !recommended) return;
    setServerRam(recommended);
  }, [ramAuto, recommended]);

  const ramOptions = useMemo(() => {
    const max = safeRamMaxGb || 12;
    const floor = recommended ?? 4;
    const options: number[] = [];
    for (let i = 0; i <= 3; i += 1) {
      const next = floor + i * 2;
      if (next <= max) options.push(next);
    }
    if (serverRam && !options.includes(serverRam)) {
      options.unshift(serverRam);
    }
    return options;
  }, [safeRamMaxGb, recommended, serverRam]);

  const canNext = useMemo(() => {
    if (step === 0) return Boolean(host);
    if (step === 1) return Boolean(host);
    if (step === 2) return Boolean(worldValidation?.valid);
    if (step === 3) return Boolean(worldValidation?.valid);
    if (step === 4) return Boolean(serverName.trim() && serverVersion.trim());
    return false;
  }, [step, host, worldValidation, serverName, serverVersion]);

  const handlePickWorldZip = async () => {
    setWorldBusy(true);
    setWorldError(null);
    try {
      const result = await pickAndValidateWorld("zip");
      if (!result) return;
      setWorldSourcePath(result.sourcePath);
      setWorldValidation(result.validation);
    } catch (err) {
      setWorldError(String(err));
      setWorldValidation(null);
    } finally {
      setWorldBusy(false);
    }
  };

  const handlePickMods = async (kind: "zip" | "folder") => {
    setModsBusy(true);
    setModsError(null);
    try {
      const result = await pickAndValidateMods(kind);
      if (!result) return;
      setModsValidation(result.validation);
    } catch (err) {
      setModsError(String(err));
      setModsValidation(null);
    } finally {
      setModsBusy(false);
    }
  };

  const handleModsDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    const filePath = (files[0] as File & { path?: string }).path;
    if (!filePath) {
      setModsError("Cannot read file path for dropped mods.");
      return;
    }
    setModsBusy(true);
    setModsError(null);
    try {
      const sourceKind = getWorldSourceKind(filePath);
      const validation = await validateModsSource(filePath, sourceKind);
      setModsValidation(validation);
    } catch (err) {
      setModsError(String(err));
    } finally {
      setModsBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!worldValidation?.valid || !worldSourcePath) return;
    setCreating(true);
    setCreateError(null);
    try {
      const worldImport = buildWorldImportPayload(worldSourcePath, worldValidation);
      const modImport: ModsImportPayload | null = modsValidation?.valid
        ? {
            source_path: modsValidation.mods_path,
            source_kind: modsValidation.source_kind,
            staged_path: modsValidation.staged_path ?? null
          }
        : null;

      await onCreate({
        name: serverName.trim(),
        serverType,
        version: serverVersion.trim(),
        ramGb: serverRam,
        onlineMode,
        worldImport,
        modImport
      });
    } catch (err) {
      setCreateError(String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Card title="Smart Migration Wizard">
        <div className="grid gap-6">
          <div className="grid gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Progress</p>
            <div className="flex flex-wrap items-center gap-2">
              {steps.map((label, index) => (
                <span
                  key={label}
                  className={classNames(
                    "rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
                    index === step
                      ? "bg-one/20 text-one ring-1 ring-one/40"
                      : index < step
                      ? "bg-secondary/20 text-secondary"
                      : "bg-white/10 text-muted"
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          {step === 0 && (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs uppercase tracking-[0.2em] text-muted">Hosting</label>
                <span className="text-xs text-muted" title="Choose where your world currently lives.">?
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  { value: "aternos", label: "Aternos" },
                  { value: "minehut", label: "Minehut" },
                  { value: "other", label: "Other" },
                  { value: "zip", label: "I have a world ZIP" }
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={classNames(
                      "rounded-2xl border border-white/10 px-4 py-3 text-left text-sm transition",
                      host === option.value
                        ? "border-one/40 bg-one/15 text-text"
                        : "bg-white/5 text-muted hover:bg-white/10"
                    )}
                    onClick={() => setHost(option.value)}
                  >
                    <p className="text-sm font-semibold text-text">{option.label}</p>
                    <p className="text-xs text-muted">Select your current host.</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs uppercase tracking-[0.2em] text-muted">Instructions</label>
                <span className="text-xs text-muted" title="Follow these steps to download your world.">?
                </span>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-sm font-semibold text-text">{instructions?.title}</p>
                <ul className="mt-3 grid gap-2 text-xs text-muted">
                  {instructions?.steps.map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
                {instructions?.helpUrl && (
                  <div className="mt-4">
                    <SubtleButton onClick={() => instructions.helpUrl && openUrl(instructions.helpUrl)}>
                      Open help article
                    </SubtleButton>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs uppercase tracking-[0.2em] text-muted">World ZIP</label>
                <span className="text-xs text-muted" title="Upload the ZIP export from your host.">?
                </span>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-xs text-muted">Upload your exported world ZIP.</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <PrimaryButton onClick={handlePickWorldZip} disabled={worldBusy}>
                    Select world ZIP
                  </PrimaryButton>
                  {worldValidation?.valid && (
                    <span className="rounded-full bg-secondary/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary">
                      World ready
                    </span>
                  )}
                </div>
                {worldBusy && <p className="mt-2 text-xs text-muted">Validating world...</p>}
                {worldValidation?.valid && (
                  <div className="mt-3 grid gap-2 text-xs text-muted">
                    <p>World name: {worldValidation.world_name}</p>
                    {worldValidation.detected_version && (
                      <p>Detected version: {worldValidation.detected_version}</p>
                    )}
                    {worldValidation.detected_type && (
                      <p>Detected loader: {worldValidation.detected_type === "forge" ? "Forge" : "Vanilla"}</p>
                    )}
                  </div>
                )}
                {worldError && <p className="mt-2 text-xs text-danger">{worldError}</p>}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs uppercase tracking-[0.2em] text-muted">Detection</label>
                <span className="text-xs text-muted" title="We scan the world ZIP for version and loader.">?
                </span>
              </div>
              <div className="grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-sm font-semibold text-text">Detected info</p>
                  <div className="mt-3 grid gap-2 text-xs text-muted">
                    <p>Loader: {detection?.loader ?? "unknown"}</p>
                    <p>Version: {detection?.version ?? "unknown"}</p>
                    <p>Mods: {modsValidation?.mod_count ?? 0}</p>
                  </div>
                </div>

                {modComparison.mismatch && (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-4 text-xs text-amber-200">
                    <p>{modComparison.reason}</p>
                    <p className="mt-1">Some mods may be missing. Add them now?</p>
                  </div>
                )}

                {(modComparison.mismatch || modsValidation) && (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                    <p className="text-xs text-muted">Add mods or modpacks now.</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <PrimaryButton onClick={() => handlePickMods("zip")} disabled={modsBusy}>
                        Select modpack ZIP
                      </PrimaryButton>
                      <SubtleButton onClick={() => handlePickMods("folder")} disabled={modsBusy}>
                        Select mods folder
                      </SubtleButton>
                    </div>
                    <div
                      className="mt-3 rounded-2xl border border-dashed border-white/20 bg-white/5 px-4 py-4 text-center text-xs text-muted"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={handleModsDrop}
                    >
                      Drag & drop modpack ZIP or mods folder here
                    </div>
                    {modsBusy && <p className="mt-2 text-xs text-muted">Validating mods...</p>}
                    {modsValidation?.valid && (
                      <p className="mt-2 text-xs text-muted">Mods detected: {modsValidation.mod_count}</p>
                    )}
                    {modsError && <p className="mt-2 text-xs text-danger">{modsError}</p>}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs uppercase tracking-[0.2em] text-muted">Auto-configure</label>
                <span className="text-xs text-muted" title="We prefill settings based on detection.">?
                </span>
              </div>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted">Server name</label>
                  <input
                    value={serverName}
                    onChange={(event) => {
                      setServerName(event.target.value);
                      setConfigTouched(true);
                    }}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text focus:border-one/50 focus:outline-none"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted">Loader</label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: "vanilla", label: "Vanilla" },
                      { value: "forge", label: "Forge" },
                      { value: "fabric", label: "Fabric" }
                    ] as const).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={classNames(
                          "rounded-full px-4 py-2 text-xs font-semibold transition",
                          serverType === option.value
                            ? "bg-one text-white"
                            : "bg-white/10 text-text hover:bg-white/20"
                        )}
                        onClick={() => {
                          setServerType(option.value);
                          setConfigTouched(true);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted">Version</label>
                  <input
                    value={serverVersion}
                    onChange={(event) => {
                      setServerVersion(event.target.value);
                      setConfigTouched(true);
                    }}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text focus:border-one/50 focus:outline-none"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted">RAM Allocation</label>
                  {systemRamGb && (
                    <p className="text-xs text-muted">
                      You have {systemRamGb} GB RAM. Recommended: {recommended ?? systemRamGb} GB.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {ramOptions.map((ram) => (
                      <button
                        key={ram}
                        type="button"
                        className={classNames(
                          "rounded-full px-4 py-2 text-xs font-semibold transition",
                          serverRam === ram
                            ? "bg-one text-white"
                            : "bg-white/10 text-text hover:bg-white/20",
                          ram === recommended && serverRam !== ram ? "ring-1 ring-one/40" : ""
                        )}
                        onClick={() => {
                          setServerRam(ram);
                          setRamAuto(false);
                        }}
                      >
                        {ram} GB
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {recommended && !ramAuto && (
                      <SubtleButton
                        className="bg-one/20 text-one ring-1 ring-one/40 hover:bg-one/25"
                        onClick={() => {
                          setRamAuto(true);
                          setServerRam(recommended);
                        }}
                      >
                        Use recommended
                      </SubtleButton>
                    )}
                    <span className="text-xs text-muted">Min 1 GB · Max {safeRamMaxGb} GB</span>
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-text">Online mode</p>
                    <p className="text-xs text-muted">Turn off to allow non-official launchers.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={classNames(
                        "rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
                        onlineMode ? "bg-secondary/20 text-secondary" : "bg-white/10 text-muted"
                      )}
                    >
                      {onlineMode ? "On" : "Off"}
                    </span>
                    <Switch.Root
                      checked={onlineMode}
                      onCheckedChange={setOnlineMode}
                      className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
                    >
                      <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
                    </Switch.Root>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs uppercase tracking-[0.2em] text-muted">Summary</label>
                <span className="text-xs text-muted" title="Review before creating the server.">?
                </span>
              </div>
              <div className="grid gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                  <p className="text-sm font-semibold text-text">Validation summary</p>
                  <div className="mt-3 grid gap-2 text-xs text-muted">
                    <p>{worldValidation?.valid ? "OK" : "Missing"} World imported</p>
                    <p>{detection?.loader ? "OK" : "Missing"} Loader detected</p>
                    <p>
                      {modsValidation?.valid || !modComparison.mismatch ? "OK" : "Missing"} Mods installed
                    </p>
                  </div>
                </div>
                {createError && <p className="text-xs text-danger">{createError}</p>}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <SubtleButton onClick={onBack}>Cancel</SubtleButton>
              {step > 0 && <SubtleButton onClick={() => setStep((prev) => Math.max(0, prev - 1))}>Back</SubtleButton>}
            </div>
            <div className="flex items-center gap-2">
              {step < steps.length - 1 && (
                <PrimaryButton onClick={() => setStep((prev) => Math.min(steps.length - 1, prev + 1))} disabled={!canNext}>
                  Next
                </PrimaryButton>
              )}
              {step === steps.length - 1 && (
                <PrimaryButton onClick={handleCreate} disabled={creating || !worldValidation?.valid}>
                  {creating ? "Creating..." : "Create server"}
                </PrimaryButton>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
