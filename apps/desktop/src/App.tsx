import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { appDataDir, dataDir, join } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { exists, readFile, readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { AnimatePresence, motion } from "framer-motion";
import lottie from "lottie-web";
import * as Tabs from "@radix-ui/react-tabs";
import * as Switch from "@radix-ui/react-switch";
import * as Select from "@radix-ui/react-select";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { BrandName } from "./components/BrandName";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { CrashModal } from "./components/modals/CrashModal";
import { DeleteServerModal } from "./components/modals/DeleteServerModal";
import { ImportServerModal } from "./components/modals/ImportServerModal";
import { JavaModal } from "./components/modals/JavaModal";
import { LauncherModal } from "./components/modals/LauncherModal";
import { WorldStep } from "./components/CreateServerWizard/WorldStep";
import { ModsStep } from "./components/CreateServerWizard/ModsStep";
import { ServerSettingsFields } from "./components/ServerSettingsFields";
import { PrimaryButton, SubtleButton } from "./components/ui/Buttons";
import { Card } from "./components/ui/Card";
import { SegmentedBar } from "./components/ui/SegmentedBar";
import { SettingRow } from "./components/ui/SettingRow";
import { StatusPill } from "./components/ui/StatusPill";
import { MigrationWizard, type MigrationCreatePayload } from "./wizard/MigrationWizard";
import { classNames } from "./utils/classNames";
import { buildWorldImportPayload, pickAndValidateWorld } from "./services/worldImport";
import { pickAndValidateMods } from "./services/modImport";
import { detectServerMetadata } from "./services/modDetection";
import { detectClient } from "./services/clientDetector";
import { compareClientToServer } from "./services/versionComparator";
import { launchMinecraft as launchMinecraftClient } from "./services/minecraftLauncher";
import { ensureClientLoaderInstalled } from "./services/loaderInstaller";
import { createLauncherProfile } from "./services/launcherProfileManager";
import { resolveRequiredClient } from "./services/versionResolver";
import { useServerMetadata } from "./hooks/useServerMetadata";
import type {
  AppSettings,
  ApplyResult,
  BackupEntry,
  CrashReport,
  CrashReportSummary,
  ImportAnalysis,
  JavaStatusResult,
  LauncherChoice,
  ClientDetectionResult,
  ModEntry,
  ModpackManifest,
  ModSyncStatus,
  ModsImportMode,
  ModsValidationResult,
  NetworkInfo,
  ResourceUsage,
  ServerConfig,
  ServerMeta,
  ServerSettings,
  ServerStatus,
  UpdateInfo,
  VersionGroup,
  View,
  WorldCopyProgress,
  WorldImportMode,
  WorldImportPayload,
  WorldValidationResult
} from "./types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const SERVER_TYPES = [
  { value: "vanilla", label: "Vanilla" },
  { value: "paper", label: "Paper" },
  { value: "forge", label: "Forge" }
] as const;

const IMPORT_SERVER_TYPES = [
  ...SERVER_TYPES,
  { value: "fabric", label: "Fabric" }
] as const;

const VERSION_OPTIONS: Record<ServerConfig["server_type"], VersionGroup[]> = {
  vanilla: [
    {
      label: "Latest",
      versions: [
        { value: "1.21.4", recommended: true },
        { value: "1.21.3" },
        { value: "1.21.1" },
        { value: "1.21.0" },
        { value: "1.20.6" },
        { value: "1.20.4" },
        { value: "1.20.2" },
        { value: "1.20.1" }
      ]
    },
    {
      label: "Stable",
      versions: [
        { value: "1.19.4" },
        { value: "1.19.2" },
        { value: "1.18.2" },
        { value: "1.17.1" },
        { value: "1.16.5" },
        { value: "1.15.2" },
        { value: "1.14.4" },
        { value: "1.13.2" },
        { value: "1.12.2" },
        { value: "1.11.2" },
        { value: "1.10.2" },
        { value: "1.9.4" },
        { value: "1.8.9" }
      ]
    }
  ],
  paper: [
    {
      label: "Recommended",
      versions: [
        { value: "1.21.4", recommended: true },
        { value: "1.21.3" },
        { value: "1.21.2" },
        { value: "1.21.1" },
        { value: "1.21.0" },
        { value: "1.20.6" },
        { value: "1.20.4" },
        { value: "1.20.2" },
        { value: "1.20.1" }
      ]
    },
    {
      label: "Legacy",
      versions: [
        { value: "1.19.4" },
        { value: "1.19.2" },
        { value: "1.18.2" },
        { value: "1.17.1" },
        { value: "1.16.5" },
        { value: "1.15.2" },
        { value: "1.14.4" },
        { value: "1.13.2" },
        { value: "1.12.2" }
      ]
    }
  ],
  forge: [
    {
      label: "Latest",
      versions: [
        { value: "1.21.1-52.0.8", recommended: true },
        { value: "1.20.1-47.2.0" },
        { value: "1.19.2-43.3.5" },
        { value: "1.18.2-40.2.21" }
      ]
    },
    {
      label: "Classic",
      versions: [
        { value: "1.16.5-36.2.39" },
        { value: "1.12.2-14.23.5.2860" },
        { value: "1.7.10-10.13.4.1614" }
      ]
    }
  ]
  ,
  fabric: [
    {
      label: "Detected",
      versions: [{ value: "unknown" }]
    }
  ]
};

const RAM_OPTIONS = [2, 4, 6, 8, 12];
const MAX_VERSION_OPTIONS = 200;
const MAX_VERSION_OPTIONS_FORGE = 5;
const BACKUP_INTERVALS = [30, 60, 360, 1440] as const;
const UPDATE_REPO = "Adlikkk/gamehost-one-app";

type TutorialStep = {
  id: string;
  view: View;
  tab?: string;
  selector: string;
  title: string;
  body: string;
};

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "open-minecraft",
    view: "library",
    selector: "[data-tutorial='open-minecraft']",
    title: "Open Minecraft",
    body: "Start by opening the Minecraft library to manage your servers."
  },
  {
    id: "create",
    view: "servers",
    selector: "[data-tutorial='create-server']",
    title: "Create a server",
    body: "Start by creating a new Minecraft server for Gamehost ONE."
  },
  {
    id: "ram",
    view: "wizard",
    selector: "[data-tutorial='ram-allocation']",
    title: "Set RAM allocation",
    body: "Adjust memory based on your system capacity and server size."
  },
  {
    id: "start",
    view: "detail",
    tab: "overview",
    selector: "[data-tutorial='start-server']",
    title: "Start the server",
    body: "Use Start to boot the server when you are ready."
  },
  {
    id: "console",
    view: "detail",
    tab: "console",
    selector: "[data-tutorial='console-tab']",
    title: "Console commands",
    body: "Monitor logs and send commands directly to the server console."
  },
  {
    id: "backups",
    view: "detail",
    tab: "advanced",
    selector: "[data-tutorial='backups-card']",
    title: "Backups",
    body: "Manage manual and automatic backups to protect your world."
  }
];

const DEFAULT_SETTINGS: ServerSettings = {
  sleepPlayers: 1,
  difficulty: "Normal",
  gameMode: "Survival",
  pvp: true,
  allowFlight: false,
  maxPlayers: 20,
  viewDistance: 10
};

const getDefaultVersion = (serverType: ServerConfig["server_type"]) => {
  const groups = VERSION_OPTIONS[serverType];
  for (const group of groups) {
    const recommended = group.versions.find((version) => version.recommended);
    if (recommended) return recommended.value;
  }
  return groups[0]?.versions[0]?.value ?? "1.20.6";
};

const container = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { staggerChildren: 0.12 } }
};

const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } };

const getActionState = (status: ServerStatus) => {
  const starting = status === "STARTING";
  return {
    canStart: status === "STOPPED" || status === "ERROR",
    canStop: status === "RUNNING",
    canRestart: status === "RUNNING",
    showStarting: starting,
    statusLabel: starting ? "Starting server..." : null
  };
};

function CreateServerMenu({
  label,
  onCreate,
  onImport,
  onMigrate,
  dataTutorial
}: {
  label: string;
  onCreate: () => void;
  onImport: () => void;
  onMigrate: () => void;
  dataTutorial?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative inline-flex group" ref={menuRef}>
      <div className="inline-flex overflow-hidden rounded-full bg-one shadow-soft transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_12px_30px_rgba(79,209,197,0.25)]">
        <button
          type="button"
          className="px-5 py-2 text-sm font-semibold text-white transition hover:bg-one/90"
          onClick={() => {
            setOpen(false);
            onCreate();
          }}
          data-tutorial={dataTutorial}
        >
          {label}
        </button>
        <button
          type="button"
          className="flex items-center px-3 text-sm font-semibold text-white transition hover:bg-one/90"
          aria-label="Open create server menu"
          onClick={() => setOpen((prev) => !prev)}
        >
          <span className="h-5 w-px bg-white/25 transition group-hover:bg-white/40" aria-hidden="true" />
          <span className="pl-3" aria-hidden="true">
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8l4 4 4-4" />
            </svg>
          </span>
        </button>
      </div>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-2xl border border-white/10 bg-surface shadow-soft">
          <button
            className="flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-sm text-text transition hover:bg-white/10"
            onClick={() => {
              setOpen(false);
              onImport();
            }}
          >
            Import existing server
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-sm text-text transition hover:bg-white/10"
            onClick={() => {
              setOpen(false);
              onMigrate();
            }}
          >
            Migrate hosted world
          </button>
        </div>
      )}
    </div>
  );
}

const normalizeStatus = (value: string): ServerStatus => {
  if (value === "STOPPED" || value === "STARTING" || value === "RUNNING" || value === "ERROR") {
    return value;
  }
  return "STOPPED";
};

function getServerTypeLabel(value: ServerConfig["server_type"]) {
  return (
    IMPORT_SERVER_TYPES.find((type) => type.value === value)?.label ??
    value.charAt(0).toUpperCase() + value.slice(1)
  );
}

function formatLoaderLabel(value?: string | null) {
  if (!value || value === "none") return "Vanilla";
  if (value === "quilt") return "Quilt";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getForgeDownloadUrl(version?: string | null) {
  if (!version) return null;
  const mcVersion = version.split("-")[0]?.trim();
  if (!mcVersion) return null;
  return `https://files.minecraftforge.net/net/minecraftforge/forge/index_${mcVersion}.html`;
}

function normalizeRamEven(value: number) {
  return value > 1 && value % 2 === 1 ? value - 1 : value;
}

function countVersions(groups: VersionGroup[]) {
  return groups.reduce((total, group) => total + group.versions.length, 0);
}

function trimVersionGroups(groups: VersionGroup[], term: string, limit = MAX_VERSION_OPTIONS) {
  const normalized = term.trim().toLowerCase();
  if (!normalized) {
    let remaining = limit;
    const limited = groups
      .map((group) => {
        if (remaining <= 0) return { ...group, versions: [] };
        const next = group.versions.slice(0, remaining);
        remaining -= next.length;
        return { ...group, versions: next };
      })
      .filter((group) => group.versions.length > 0);
    return limited;
  }

  return groups
    .map((group) => ({
      ...group,
      versions: group.versions.filter((version) =>
        (version.label ?? version.value).toLowerCase().includes(normalized)
      )
    }))
    .filter((group) => group.versions.length > 0);
}

function matchForgeVersion(versions: string[], detected: string) {
  const clean = detected.trim();
  if (!clean) return null;
  const minorPrefix = clean.split(".").slice(0, 2).join(".");
  return (
    versions.find((version) => version === clean) ??
    versions.find((version) => version.startsWith(`${clean}-`)) ??
    (minorPrefix ? versions.find((version) => version.startsWith(`${minorPrefix}.`)) : undefined) ??
    (minorPrefix ? versions.find((version) => version.startsWith(`${minorPrefix}-`)) : undefined) ??
    null
  );
}

function buildForgeVersionList(versions: string[], selected: string | null, limit: number) {
  const limited = versions.slice(0, limit);
  if (selected && versions.includes(selected) && !limited.includes(selected)) {
    return [selected, ...limited];
  }
  return limited;
}


function App() {
  const [view, setView] = useState<View>("loading");
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [uiToast, setUiToast] = useState<{
    tone: "success" | "error";
    message: string;
    label?: string;
  } | null>(null);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [selectedServer, setSelectedServer] = useState<ServerConfig | null>(null);
  const { metadata: serverMetadata } = useServerMetadata(selectedServer?.name);
  const [status, setStatus] = useState<ServerStatus>("STOPPED");
  const [javaModalOpen, setJavaModalOpen] = useState(false);
  const [javaStatus, setJavaStatus] = useState<JavaStatusResult | null>(null);
  const [javaBusy, setJavaBusy] = useState(false);
  const [javaDownloadProgress, setJavaDownloadProgress] = useState<number | null>(null);
  const [pendingJavaAction, setPendingJavaAction] = useState<{
    server: ServerConfig;
    action: "start" | "restart";
  } | null>(null);
  const [launcherChoice, setLauncherChoice] = useState<LauncherChoice | null>(null);
  const [launcherChoiceOpen, setLauncherChoiceOpen] = useState(false);
  const [launcherOpenedAt, setLauncherOpenedAt] = useState<number | null>(null);
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resource, setResource] = useState<ResourceUsage | null>(null);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [commandInput, setCommandInput] = useState("");
  const [appDataPath, setAppDataPath] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [appSettingsSaving, setAppSettingsSaving] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [crashReports, setCrashReports] = useState<CrashReportSummary[]>([]);
  const [crashModalOpen, setCrashModalOpen] = useState(false);
  const [activeCrashReport, setActiveCrashReport] = useState<CrashReport | null>(null);
  const [crashLoading, setCrashLoading] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [, startViewTransition] = useTransition();
  const [serverIcons, setServerIcons] = useState<Record<string, string>>({});
  const [motdDraft, setMotdDraft] = useState("");
  const [motdSaving, setMotdSaving] = useState(false);
  const [iconSaving, setIconSaving] = useState(false);
  const [wizardSettings, setWizardSettings] = useState<ServerSettings>(DEFAULT_SETTINGS);
  const [wizardAdvancedOpen, setWizardAdvancedOpen] = useState(false);
  const [wizardWorldMode, setWizardWorldMode] = useState<WorldImportMode>("generate");
  const [wizardWorldSource, setWizardWorldSource] = useState<string | null>(null);
  const [wizardWorldValidation, setWizardWorldValidation] = useState<WorldValidationResult | null>(null);
  const [wizardWorldError, setWizardWorldError] = useState<string | null>(null);
  const [wizardWorldBusy, setWizardWorldBusy] = useState(false);
  const [wizardWorldCopy, setWizardWorldCopy] = useState<WorldCopyProgress | null>(null);
  const [wizardWorldCopied, setWizardWorldCopied] = useState(false);
  const [wizardWorldDetected, setWizardWorldDetected] = useState<{
    type: "forge" | "vanilla" | null;
    version: string | null;
  }>({ type: null, version: null });
  const [wizardModsMode, setWizardModsMode] = useState<ModsImportMode>("skip");
  const [wizardModsSource, setWizardModsSource] = useState<string | null>(null);
  const [wizardModsValidation, setWizardModsValidation] = useState<ModsValidationResult | null>(null);
  const [wizardModsError, setWizardModsError] = useState<string | null>(null);
  const [wizardModsBusy, setWizardModsBusy] = useState(false);
  const [serverSettingsByName, setServerSettingsByName] = useState<Record<string, ServerSettings>>({});
  const [isMaximized, setIsMaximized] = useState(false);
  const lastStatusRef = useRef<ServerStatus>("STOPPED");
  const welcomeShownRef = useRef(false);
  const loadingAnimRef = useRef<HTMLDivElement | null>(null);
  const [activePlayers, setActivePlayers] = useState(0);
  const [detailTab, setDetailTab] = useState("overview");
  const [systemRamMb, setSystemRamMb] = useState<number | null>(null);
  const [ramDraft, setRamDraft] = useState(4);
  const [ramManualOpen, setRamManualOpen] = useState(false);
  const [ramManualInput, setRamManualInput] = useState("4");
  const [wizardRamAuto, setWizardRamAuto] = useState(true);
  const [onlineModeDraft, setOnlineModeDraft] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ServerConfig | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [mods, setMods] = useState<ModEntry[]>([]);
  const [modsLoading, setModsLoading] = useState(false);
  const [modsBulkBusy, setModsBulkBusy] = useState(false);
  const [modpack, setModpack] = useState<ModpackManifest | null>(null);
  const [modSync, setModSync] = useState<ModSyncStatus | null>(null);
  const [modSyncLoading, setModSyncLoading] = useState(false);
  const [modSyncModalOpen, setModSyncModalOpen] = useState(false);
  const [modsModalOpen, setModsModalOpen] = useState(false);
  const [modSyncChoiceOpen, setModSyncChoiceOpen] = useState(false);
  const [modSyncChoiceBusy, setModSyncChoiceBusy] = useState(false);
  const [modSyncChoiceError, setModSyncChoiceError] = useState<string | null>(null);
  const [modSyncChoiceRemember, setModSyncChoiceRemember] = useState(false);
  const [pendingLaunchAfterSync, setPendingLaunchAfterSync] = useState(false);
  const [clientStatus, setClientStatus] = useState<ClientDetectionResult | null>(null);
  const [clientChecking, setClientChecking] = useState(false);
  const [clientMismatchOpen, setClientMismatchOpen] = useState(false);
  const [clientMismatchDismissed, setClientMismatchDismissed] = useState(false);
  const [loaderInstallOpen, setLoaderInstallOpen] = useState(false);
  const [loaderInstallBusy, setLoaderInstallBusy] = useState(false);
  const [loaderInstallError, setLoaderInstallError] = useState<string | null>(null);
  const [joinHelpOpen, setJoinHelpOpen] = useState(false);
  const [joinIp, setJoinIp] = useState<string | null>(null);
  const [smartJoinDismissed, setSmartJoinDismissed] = useState(false);
  const [compatHelpOpen, setCompatHelpOpen] = useState(false);
  const [modMetaOpen, setModMetaOpen] = useState(false);
  const [modMetaPath, setModMetaPath] = useState<string | null>(null);
  const [modMetaId, setModMetaId] = useState("");
  const [modMetaVersion, setModMetaVersion] = useState("");
  const [modMetaUrl, setModMetaUrl] = useState("");
  const [modMetaBusy, setModMetaBusy] = useState(false);
  const [modMetaError, setModMetaError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importAnalysis, setImportAnalysis] = useState<ImportAnalysis | null>(null);
  const [importMode, setImportMode] = useState<"copy" | "link">("copy");
  const [importName, setImportName] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupProgress, setBackupProgress] = useState<number | null>(null);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [backupIncludeNether, setBackupIncludeNether] = useState(true);
  const [backupIncludeEnd, setBackupIncludeEnd] = useState(true);
  const [serverMeta, setServerMeta] = useState<ServerMeta | null>(null);
  const ramAlertRef = useRef<number | null>(null);
  const lastChatWarnRef = useRef(0);
  const emergencyBackupRef = useRef(false);
  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [showTutorialOnStartup, setShowTutorialOnStartup] = useState(true);
  const [wizardVersionFilter, setWizardVersionFilter] = useState("");
  const [wizardForgeVersions, setWizardForgeVersions] = useState<string[]>([]);
  const [wizardForgeLoading, setWizardForgeLoading] = useState(false);
  const [reinstallType, setReinstallType] = useState<ServerConfig["server_type"]>("vanilla");
  const [reinstallVersion, setReinstallVersion] = useState(getDefaultVersion("vanilla"));
  const [reinstallVersionFilter, setReinstallVersionFilter] = useState("");
  const [reinstallForgeVersions, setReinstallForgeVersions] = useState<string[]>([]);
  const [reinstallForgeLoading, setReinstallForgeLoading] = useState(false);
  const [reinstallBusy, setReinstallBusy] = useState(false);

  const [wizardName, setWizardName] = useState("My Minecraft Server");
  const [wizardType, setWizardType] = useState<ServerConfig["server_type"]>("vanilla");
  const [wizardVersion, setWizardVersion] = useState(getDefaultVersion("vanilla"));
  const [wizardRam, setWizardRam] = useState(4);
  const [wizardOnlineMode, setWizardOnlineMode] = useState(true);

  const activeSettings = selectedServer
    ? serverSettingsByName[selectedServer.name] ?? DEFAULT_SETTINGS
    : DEFAULT_SETTINGS;

  const normalizedStatus = normalizeStatus(status);
  const actionState = getActionState(normalizedStatus);
  const systemRamGb = useMemo(() => {
    if (!systemRamMb) return null;
    const value = systemRamMb > 1024 * 1024 ? systemRamMb / (1024 * 1024) : systemRamMb / 1024;
    return Math.max(1, Math.round(value));
  }, [systemRamMb]);
  const safeRamMaxGb = useMemo(() => {
    if (!systemRamGb) return 12;
    const capped = Math.max(1, systemRamGb - 1);
    return normalizeRamEven(capped);
  }, [systemRamGb]);
  const recommendedRamGb = useMemo(() => {
    if (!systemRamGb) return null;
    const suggested = Math.floor(systemRamGb * 0.6);
    return normalizeRamEven(Math.min(Math.max(2, suggested), safeRamMaxGb));
  }, [systemRamGb, safeRamMaxGb]);
  const wizardRecommendedRamGb = useMemo(() => {
    if (!systemRamGb) return null;
    let suggested = 4;
    if (wizardModsValidation?.mod_count) {
      suggested += Math.ceil(wizardModsValidation.mod_count / 25);
    }
    if ((wizardWorldValidation?.size_bytes ?? 0) > 1024 * 1024 * 1024) {
      suggested += 1;
    }
    suggested = Math.max(2, suggested);
    const capped = Math.min(suggested, safeRamMaxGb);
    return normalizeRamEven(capped);
  }, [systemRamGb, wizardModsValidation, wizardWorldValidation, safeRamMaxGb]);
  const serverRecommendedRamGb = useMemo(() => {
    if (!systemRamGb) return null;
    if (!modpack?.mods?.length) return recommendedRamGb;
    let suggested = 4 + Math.ceil(modpack.mods.length / 25);
    suggested = Math.max(2, suggested);
    const capped = Math.min(suggested, safeRamMaxGb);
    return normalizeRamEven(capped);
  }, [systemRamGb, modpack, recommendedRamGb, safeRamMaxGb]);
  const ramOptions = useMemo(
    () => RAM_OPTIONS.filter((ram) => (!systemRamGb ? true : ram <= systemRamGb)),
    [systemRamGb]
  );
  const wizardRamOptions = useMemo(() => {
    const max = safeRamMaxGb || 12;
    const floor = wizardRecommendedRamGb ?? recommendedRamGb ?? null;
    if (!floor) {
      return ramOptions.slice(0, 4);
    }
    const options: number[] = [];
    for (let i = 0; i <= 3; i += 1) {
      const next = floor + i * 2;
      if (next <= max) options.push(next);
    }
    if (wizardRam && !options.includes(wizardRam)) {
      options.unshift(wizardRam);
    }
    return options;
  }, [safeRamMaxGb, wizardRecommendedRamGb, recommendedRamGb, wizardRam, ramOptions]);
  const serverRamOptions = useMemo(() => {
    const max = safeRamMaxGb || 12;
    const floor = serverRecommendedRamGb ?? null;
    if (!floor) {
      return ramOptions.slice(0, 4);
    }
    const options: number[] = [];
    for (let i = 0; i <= 3; i += 1) {
      const next = floor + i * 2;
      if (next <= max) options.push(next);
    }
    if (ramDraft && !options.includes(ramDraft)) {
      options.unshift(ramDraft);
    }
    return options;
  }, [safeRamMaxGb, serverRecommendedRamGb, ramDraft, ramOptions]);
  const deleteMatches = deleteTarget ? deleteConfirm.trim() === deleteTarget.name : false;
  const detailDeleteMatches = selectedServer ? deleteConfirm.trim() === selectedServer.name : false;
  const appDataDisplay = appDataPath ?? "C:\\Users\\Adam\\AppData\\Roaming\\com.gamehost.one";
  const effectiveAppSettings = appSettings ?? {
    analytics_enabled: false,
    crash_reporting_enabled: false,
    analytics_endpoint: null,
    launcher_path: null,
    smart_join_panel_enabled: true,
    notify_on_server_start: true,
    mod_sync_mode: "ask"
  };
  const deferredWizardFilter = useDeferredValue(wizardVersionFilter);
  const deferredReinstallFilter = useDeferredValue(reinstallVersionFilter);
  const wizardWorldReady =
    wizardWorldMode === "generate" || Boolean(wizardWorldSource && wizardWorldValidation?.valid);
  const wizardModsReady =
    wizardModsMode === "skip" || Boolean(wizardModsSource && wizardModsValidation?.valid);

  const wizardVersionGroups = useMemo<VersionGroup[]>(() => {
    if (wizardType === "forge" && wizardForgeVersions.length > 0) {
      const list = buildForgeVersionList(wizardForgeVersions, wizardVersion, MAX_VERSION_OPTIONS_FORGE);
      return [{ label: "All Versions", versions: list.map((value) => ({ value })) }];
    }
    return VERSION_OPTIONS[wizardType];
  }, [wizardType, wizardForgeVersions, wizardVersion]);

  const wizardVersionLimit = wizardType === "forge" ? MAX_VERSION_OPTIONS_FORGE : MAX_VERSION_OPTIONS;
  const wizardFilteredVersionGroups = useMemo<VersionGroup[]>(
    () => trimVersionGroups(wizardVersionGroups, deferredWizardFilter, wizardVersionLimit),
    [wizardVersionGroups, deferredWizardFilter, wizardVersionLimit]
  );

  const reinstallVersionGroups = useMemo<VersionGroup[]>(() => {
    if (reinstallType === "forge" && reinstallForgeVersions.length > 0) {
      const list = buildForgeVersionList(reinstallForgeVersions, reinstallVersion, MAX_VERSION_OPTIONS_FORGE);
      return [{ label: "All Versions", versions: list.map((value) => ({ value })) }];
    }
    return VERSION_OPTIONS[reinstallType];
  }, [reinstallType, reinstallForgeVersions, reinstallVersion]);

  const reinstallVersionLimit = reinstallType === "forge" ? MAX_VERSION_OPTIONS_FORGE : MAX_VERSION_OPTIONS;
  const reinstallFilteredVersionGroups = useMemo<VersionGroup[]>(
    () => trimVersionGroups(reinstallVersionGroups, deferredReinstallFilter, reinstallVersionLimit),
    [reinstallVersionGroups, deferredReinstallFilter, reinstallVersionLimit]
  );

  const wizardVersionLimitHit = useMemo(
    () => wizardVersionFilter.trim().length === 0 && countVersions(wizardVersionGroups) > wizardVersionLimit,
    [wizardVersionFilter, wizardVersionGroups, wizardVersionLimit]
  );

  const reinstallVersionLimitHit = useMemo(
    () => reinstallVersionFilter.trim().length === 0 && countVersions(reinstallVersionGroups) > reinstallVersionLimit,
    [reinstallVersionFilter, reinstallVersionGroups, reinstallVersionLimit]
  );

  const updateActiveSettings = (next: ServerSettings) => {
    if (!selectedServer) return;
    setServerSettingsByName((prev) => ({ ...prev, [selectedServer.name]: next }));
  };

  const updateWizardSettings = (next: ServerSettings) => setWizardSettings(next);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => setFatalError(event.message || "Unexpected error");
    const handleRejection = (event: PromiseRejectionEvent) =>
      setFatalError(String(event.reason ?? "Unhandled promise"));

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    const loadingTimer = setTimeout(() => setView("library"), 3000);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
      clearTimeout(loadingTimer);
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;

    const init = async () => {
      try {
        const list = await invoke<ServerConfig[]>("list_servers");
        setServers(list);
        list.forEach((server) => {
          detectServerMetadata(server.name).catch(() => {});
        });
        if (list.length > 0) {
          setSelectedServer(list[0]);
          await loadServerIcons(list);
        }
      } catch {
        setServers([]);
      }

      try {
        const active = await invoke<string | null>("get_active_server_id");
        setActiveServerId(active);
        if (active) {
          const current = await invoke<ServerStatus>("get_status", { serverId: active });
          setStatus(normalizeStatus(String(current)));
        } else {
          setStatus("STOPPED");
        }
      } catch {
        setStatus("STOPPED");
      }

      await refreshNetwork();
    };

    init();

    const unlistenPromise = Promise.all([
      listen<string>("console_line", (event) => {
        setConsoleLines((prev) => {
          const next = [...prev, event.payload];
          return next.length > 400 ? next.slice(-400) : next;
        });
        if (event.payload.includes(" joined the game")) {
          setActivePlayers((prev) => Math.max(0, prev + 1));
        }
        if (event.payload.includes(" left the game")) {
          setActivePlayers((prev) => Math.max(0, prev - 1));
        }
      }),
      listen("server:start", () => setStatus("STARTING")),
      listen("server:ready", () => setStatus("RUNNING")),
      listen("server:error", () => setStatus("ERROR")),
      listen("server:stopped", () => setStatus("STOPPED")),
      listen<{ server_id: string; progress: number }>("backup:progress", (event) => {
        setBackupProgress(event.payload.progress);
      }),
      listen<{ server_id: string; progress: number }>("export:progress", (event) => {
        setExportProgress(event.payload.progress);
      }),
      listen<number>("java:download", (event) => {
        const value = Math.max(0, Math.min(100, Number(event.payload)));
        setJavaDownloadProgress(value);
      }),
      listen<WorldCopyProgress>("world:copy", (event) => {
        setWizardWorldCopy(event.payload);
        if (event.payload.percent >= 100) {
          setWizardWorldCopied(true);
        }
      })
    ]);

    return () => {
      unlistenPromise.then((callbacks) => callbacks.forEach((unlisten) => unlisten()));
    };
  }, []);

  useEffect(() => {
    if (view !== "loading" || !loadingAnimRef.current) return;
    let animation: ReturnType<typeof lottie.loadAnimation> | null = null;
    let active = true;

    fetch("/animations/Loading.json")
      .then((response) => response.json())
      .then((data) => {
        if (!active || !loadingAnimRef.current) return;
        animation = lottie.loadAnimation({
          container: loadingAnimRef.current,
          renderer: "svg",
          loop: true,
          autoplay: true,
          animationData: data
        });
      })
      .catch(() => {
        // Ignore animation errors.
      });

    return () => {
      active = false;
      if (animation) {
        animation.destroy();
      }
    };
  }, [view]);

  useEffect(() => {
    if (!isTauri) return;
    invoke<number>("get_system_ram")
      .then((value) => setSystemRamMb(value))
      .catch(() => setSystemRamMb(null));
  }, []);

  useEffect(() => {
    if (!isTauri) return;

    const interval = setInterval(async () => {
      try {
        if (status === "RUNNING" && activeServerId) {
          const usage = await invoke<ResourceUsage>("get_resource_usage", { serverId: activeServerId });
          setResource(usage);
        } else {
          setResource(null);
        }
      } catch {
        setResource(null);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [status, activeServerId]);

  useEffect(() => {
    if (!activeServerId) {
      setStatus("STOPPED");
    }
  }, [activeServerId]);

  useEffect(() => {
    if (view !== "detail") return;
    refreshClientStatus();
    const interval = setInterval(() => {
      refreshClientStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [view]);

  useEffect(() => {
    if (!isTauri) return;
    const window = getCurrentWindow();

    const syncMaximized = async () => {
      const value = await window.isMaximized();
      setIsMaximized(value);
    };

    syncMaximized();
    const unlisten = window.onResized(() => {
      syncMaximized();
    });

    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);


  useEffect(() => {
    setWizardVersionFilter("");
    if (wizardType !== "forge") {
      setWizardForgeVersions([]);
      setWizardVersion(getDefaultVersion(wizardType));
      return;
    }

    setWizardForgeLoading(true);
    invoke<string[]>("get_forge_versions")
      .then((versions) => {
        setWizardForgeVersions(versions);
        if (versions.length === 0) return;
        const detected = wizardWorldDetected.type === "forge" ? wizardWorldDetected.version : null;
        const match = detected ? matchForgeVersion(versions, detected) : null;
        setWizardVersion(match ?? versions[0]);
      })
      .catch(() => setWizardForgeVersions([]))
      .finally(() => setWizardForgeLoading(false));
  }, [wizardType, wizardWorldDetected]);

  useEffect(() => {
    if (wizardWorldMode !== "import" || !wizardWorldDetected.type) return;
    if (wizardType !== wizardWorldDetected.type) {
      setWizardType(wizardWorldDetected.type);
    }
  }, [wizardWorldMode, wizardWorldDetected.type, wizardType]);

  useEffect(() => {
    if (wizardWorldMode !== "import") return;
    if (wizardWorldDetected.type !== "forge") return;
    if (!wizardWorldDetected.version) return;
    if (wizardForgeVersions.length === 0) return;
    const match = matchForgeVersion(wizardForgeVersions, wizardWorldDetected.version) ?? wizardForgeVersions[0];
    if (match && wizardVersion !== match) setWizardVersion(match);
  }, [wizardWorldMode, wizardWorldDetected, wizardForgeVersions, wizardVersion]);

  useEffect(() => {
    if (wizardWorldMode !== "import") return;
    if (wizardWorldDetected.type !== "vanilla") return;
    if (!wizardWorldDetected.version) return;
    if (wizardVersion !== wizardWorldDetected.version) {
      setWizardVersion(wizardWorldDetected.version);
    }
  }, [wizardWorldMode, wizardWorldDetected, wizardVersion]);

  useEffect(() => {
    if (wizardWorldMode === "generate") {
      setWizardWorldSource(null);
      setWizardWorldValidation(null);
      setWizardWorldError(null);
      setWizardWorldCopy(null);
      setWizardWorldCopied(false);
      setWizardWorldDetected({ type: null, version: null });
      setWizardRamAuto(true);
    }
  }, [wizardWorldMode]);

  useEffect(() => {
    if (wizardModsMode === "skip") {
      setWizardModsSource(null);
      setWizardModsValidation(null);
      setWizardModsError(null);
    }
  }, [wizardModsMode]);

  useEffect(() => {
    if (wizardType !== "forge" && wizardModsMode !== "skip") {
      setWizardModsMode("skip");
    }
  }, [wizardType, wizardModsMode]);

  useEffect(() => {
    if (!wizardWorldValidation?.valid) return;
    setWizardWorldDetected({
      type: wizardWorldValidation.detected_type ?? null,
      version: wizardWorldValidation.detected_version?.trim() ?? null
    });
  }, [wizardWorldValidation]);

  useEffect(() => {
    setReinstallVersionFilter("");
    if (reinstallType !== "forge") {
      setReinstallForgeVersions([]);
      setReinstallVersion(getDefaultVersion(reinstallType));
      return;
    }

    const preferredVersion =
      selectedServer && selectedServer.server_type === "forge" ? selectedServer.version : null;

    setReinstallForgeLoading(true);
    invoke<string[]>("get_forge_versions")
      .then((versions) => {
        setReinstallForgeVersions(versions);
        if (versions.length > 0) {
          const next = preferredVersion && versions.includes(preferredVersion) ? preferredVersion : versions[0];
          setReinstallVersion(next);
        }
      })
      .catch(() => setReinstallForgeVersions([]))
      .finally(() => setReinstallForgeLoading(false));
  }, [reinstallType, selectedServer]);

  useEffect(() => {
    if (!selectedServer) return;
    loadMotd(selectedServer);
    setActivePlayers(0);
    loadMods(selectedServer);
    loadBackups(selectedServer);
    loadServerMeta(selectedServer);
    loadModpack(selectedServer);
    refreshModSync(selectedServer);
    refreshClientStatus();
  }, [selectedServer]);

  useEffect(() => {
    if (!selectedServer) return;
    setRamDraft(selectedServer.ram_gb);
    setRamManualInput(String(selectedServer.ram_gb));
    setOnlineModeDraft(selectedServer.online_mode);
    setReinstallType(selectedServer.server_type === "fabric" ? "vanilla" : selectedServer.server_type);
    setReinstallVersion(selectedServer.version);
    setReinstallVersionFilter("");
  }, [selectedServer]);

  useEffect(() => {
    if (!safeRamMaxGb) return;
    if (wizardRam > safeRamMaxGb) {
      setWizardRam(safeRamMaxGb);
    }
    if (ramDraft > safeRamMaxGb) {
      setRamDraft(safeRamMaxGb);
      setRamManualInput(String(safeRamMaxGb));
    }
  }, [safeRamMaxGb, wizardRam, ramDraft]);

  useEffect(() => {
    if (!wizardRamAuto || !wizardRecommendedRamGb) return;
    if (wizardRam !== wizardRecommendedRamGb) {
      setWizardRam(wizardRecommendedRamGb);
      setRamManualInput(String(wizardRecommendedRamGb));
    }
  }, [wizardRamAuto, wizardRecommendedRamGb, wizardRam]);

  useEffect(() => {
    if (!selectedServer) return;
    setServerSettingsByName((prev) =>
      prev[selectedServer.name] ? prev : { ...prev, [selectedServer.name]: DEFAULT_SETTINGS }
    );
  }, [selectedServer]);

  useEffect(() => {
    if (!uiToast) return;
    const timeout = setTimeout(() => setUiToast(null), 3500);
    return () => clearTimeout(timeout);
  }, [uiToast]);

  useEffect(() => {
    window.localStorage.setItem("gho_show_tutorial", String(showTutorialOnStartup));
  }, [showTutorialOnStartup]);

  useEffect(() => {
    const stored = window.localStorage.getItem("gho_launcher_choice");
    if (stored === "official" || stored === "tlauncher") {
      setLauncherChoice(stored);
      return;
    }
    if (stored === "custom") {
      setLauncherChoice("tlauncher");
    }
  }, []);

  useEffect(() => {
    if (!launcherChoice) return;
    window.localStorage.setItem("gho_launcher_choice", launcherChoice);
  }, [launcherChoice]);

  useEffect(() => {
    if (clientStatus?.running) {
      setLauncherOpenedAt(null);
    }
  }, [clientStatus]);

  useEffect(() => {
    if (!launcherOpenedAt) return;
    const timeout = setTimeout(() => setLauncherOpenedAt(null), 60000);
    return () => clearTimeout(timeout);
  }, [launcherOpenedAt]);

  useEffect(() => {
    if (view !== "library" || welcomeShownRef.current) return;
    const welcomeTimer = setTimeout(() => {
      setUiToast({ tone: "success", message: "Welcome gamer! 👋", label: "Welcome" });
      welcomeShownRef.current = true;
    }, 200);
    return () => clearTimeout(welcomeTimer);
  }, [view]);

  useEffect(() => {
    const prev = lastStatusRef.current;
    const notify = async (title: string, body: string) => {
      const granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        if (permission !== "granted") return;
      }
      sendNotification({ title, body });
    };

    const serverName =
      (activeServerId && servers.find((server) => server.name === activeServerId)?.name) ||
      selectedServer?.name ||
      "Server";

    if (status === "RUNNING" && prev !== "RUNNING") {
      setUiToast({ tone: "success", message: "Your server is up and running!" });
      if (effectiveAppSettings.notify_on_server_start !== false) {
        notify("Server is running", `${serverName} is now online.`);
      }
      setSmartJoinDismissed(false);
    }
    if (status === "ERROR" && prev !== "ERROR") {
      setUiToast({ tone: "error", message: "Server failed to start. Check logs." });
      notify("Gamehost ONE", "Server failed to start. Check logs.");
    }
    if (status === "STOPPED" && prev !== "STOPPED") {
      setUiToast({ tone: "success", message: "Server stopped." });
      notify("Gamehost ONE", "Server stopped.");
      setActivePlayers(0);
      setSmartJoinDismissed(false);
    }
    lastStatusRef.current = status;
  }, [status, activeServerId, servers, selectedServer, effectiveAppSettings.notify_on_server_start]);

  useEffect(() => {
    if (!isTauri) return;
    invoke<string | null>("get_active_server_id")
      .then((value) => setActiveServerId(value))
      .catch(() => {});
  }, [status]);

  useEffect(() => {
    const initAppData = async () => {
      if (!isTauri) return;
      try {
        const path = await appDataDir();
        setAppDataPath(path);
      } catch {
        setAppDataPath(null);
      }
    };

    initAppData();
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    getVersion()
      .then((version) => setAppVersion(version))
      .catch(() => setAppVersion(null));
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    loadAppSettings();
    loadCrashReports();
    handleCheckUpdates(true);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("gho_show_tutorial");
    if (stored !== null) {
      setShowTutorialOnStartup(stored === "true");
    }
  }, []);

  useEffect(() => {
    if (view !== "library" || !showTutorialOnStartup) return;
    const completed = window.localStorage.getItem("gho_tutorial_done");
    if (completed === "true") return;
    setTutorialActive(true);
    setTutorialStepIndex(0);
  }, [view, showTutorialOnStartup]);

  const memoryUsageMb = useMemo(() => {
    if (!resource) return null;
    const ratio = resource.memory_mb > resource.memory_limit_mb * 8 ? 1 / 1024 : 1;
    return resource.memory_mb * ratio;
  }, [resource]);

  const memoryUsageGb = useMemo(() => {
    if (memoryUsageMb === null) return null;
    return memoryUsageMb / 1024;
  }, [memoryUsageMb]);

  const memoryLimitGb = useMemo(() => {
    if (!resource) return null;
    return resource.memory_limit_mb / 1024;
  }, [resource]);

  const memoryPercent = useMemo(() => {
    if (!resource || memoryUsageMb === null) return 0;
    return Math.min(100, (memoryUsageMb / resource.memory_limit_mb) * 100);
  }, [resource, memoryUsageMb]);

  const ramAlertLevel = useMemo(() => {
    if (memoryPercent >= 95) return 95;
    if (memoryPercent >= 90) return 90;
    if (memoryPercent >= 80) return 80;
    return 0;
  }, [memoryPercent]);
  const ramTone = useMemo(() => {
    if (ramAlertLevel >= 90) return "danger" as const;
    if (ramAlertLevel >= 80) return "secondary" as const;
    return "primary" as const;
  }, [ramAlertLevel]);
  const ramWarningText =
    "Server is approaching its maximum RAM allocation. Consider increasing memory to avoid crashes.";

  const motdPreview = useMemo(() => {
    const safeMotd = typeof motdDraft === "string" ? motdDraft : "";
    const fallback = "Made with GameHost ONE";
    const value = safeMotd && safeMotd !== "[object Object]" ? safeMotd : fallback;
    return value.split(/(ONE)/g);
  }, [motdDraft]);

  useEffect(() => {
    if (typeof motdDraft !== "string" || motdDraft === "[object Object]") {
      setMotdDraft("");
    }
  }, [motdDraft]);

  useEffect(() => {
    if (!isTauri || !activeServerId || status !== "RUNNING") return;
    if (memoryPercent < 80) {
      ramAlertRef.current = null;
      emergencyBackupRef.current = false;
      return;
    }

    const threshold = ramAlertLevel;
    if (threshold > 0 && (ramAlertRef.current ?? 0) < threshold) {
      setUiToast({
        tone: "error",
        message: `Server is using ${Math.round(memoryPercent)}% of allocated RAM.`,
        label: "High memory"
      });
      ramAlertRef.current = threshold;
    }

    if (threshold >= 90) {
      const now = Date.now();
      if (now - lastChatWarnRef.current > 10 * 60 * 1000) {
        lastChatWarnRef.current = now;
        invoke("send_console_command", {
          serverId: activeServerId,
          command: "say ⚠ WARNING: Server memory is nearly full. Consider restarting or increasing RAM."
        }).catch(() => {});
      }
    }

    if (threshold >= 95 && !emergencyBackupRef.current) {
      emergencyBackupRef.current = true;
      invoke<BackupEntry>("create_backup", {
        serverId: activeServerId,
        includeNether: true,
        includeEnd: true,
        reason: "emergency"
      })
        .then(() => {
          if (selectedServer && selectedServer.name === activeServerId) {
            loadBackups(selectedServer);
          }
        })
        .catch(() => {});
      setUiToast({ tone: "error", message: "Emergency backup created due to high RAM usage.", label: "Backup" });
    }
  }, [activeServerId, status, memoryPercent, ramAlertLevel, selectedServer]);

  const handleMinimize = async () => {
    if (!isTauri) return;
    await getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    if (!isTauri) return;
    const window = getCurrentWindow();
    const isMaximized = await window.isMaximized();
    if (isMaximized) {
      await window.unmaximize();
    } else {
      await window.maximize();
    }
  };

  const handleClose = async () => {
    if (!isTauri) return;
    await getCurrentWindow().close();
  };

  const handleWorldModeChange = (next: WorldImportMode) => {
    setWizardWorldMode(next);
    if (next === "import") {
      setWizardWorldError(null);
    }
  };

  const handleModsModeChange = (next: ModsImportMode) => {
    setWizardModsMode(next);
    if (next !== "skip") {
      setWizardModsError(null);
    }
  };

  const handleOpenWizard = () => {
    changeView("wizard");
    if (tutorialActive && activeTutorialStep?.id === "create") {
      nextTutorial();
    }
  };

  const handlePickWorld = async (kind: "folder" | "zip") => {
    setWizardWorldBusy(true);
    setWizardWorldError(null);
    try {
      const result = await pickAndValidateWorld(kind);
      if (!result) return;
      setWizardWorldSource(result.sourcePath);
      setWizardWorldValidation(result.validation);
      setWizardWorldCopy(null);
      setWizardWorldCopied(false);
    } catch (err) {
      setWizardWorldError(String(err));
      setWizardWorldValidation(null);
    } finally {
      setWizardWorldBusy(false);
    }
  };

  const handleClearWorld = () => {
    setWizardWorldSource(null);
    setWizardWorldValidation(null);
    setWizardWorldError(null);
    setWizardWorldCopy(null);
    setWizardWorldCopied(false);
  };

  const handlePickMods = async (kind: "folder" | "zip") => {
    setWizardModsBusy(true);
    setWizardModsError(null);
    try {
      const result = await pickAndValidateMods(kind);
      if (!result) return;
      setWizardModsSource(result.sourcePath);
      setWizardModsValidation(result.validation);
    } catch (err) {
      setWizardModsError(String(err));
      setWizardModsValidation(null);
    } finally {
      setWizardModsBusy(false);
    }
  };

  const handleClearMods = () => {
    setWizardModsSource(null);
    setWizardModsValidation(null);
    setWizardModsError(null);
  };

  const handleCreateServer = async () => {
    if (!isTauri) return;
    if (!wizardWorldReady) {
      setWizardWorldError("Select a valid world before creating the server.");
      return;
    }
    if (!wizardModsReady) {
      setWizardModsError("Select valid mods or skip this step.");
      return;
    }
    setInstalling(true);
    setError(null);

    try {
      setWizardWorldCopied(false);
      const worldImportPayload: WorldImportPayload | null =
        wizardWorldMode === "import" && wizardWorldSource && wizardWorldValidation?.valid
          ? buildWorldImportPayload(wizardWorldSource, wizardWorldValidation)
          : null;
      const modImportPayload =
        wizardModsMode !== "skip" && wizardModsSource && wizardModsValidation?.valid
          ? {
              source_path: wizardModsSource,
              source_kind: wizardModsValidation.source_kind,
              staged_path: wizardModsValidation.staged_path ?? null
            }
          : null;
      const created = await invoke<ServerConfig>("create_server", {
        config: {
          name: wizardName.trim(),
          serverType: wizardType,
          version: wizardVersion,
          ramGb: wizardRam,
          onlineMode: wizardOnlineMode,
          port: 25565,
          worldImport: worldImportPayload,
          modImport: modImportPayload
        }
      });
      setServers((prev) => [...prev, created]);
      setSelectedServer(created);
      setServerSettingsByName((prev) => ({ ...prev, [created.name]: wizardSettings }));
      changeView("servers");
      await loadServerIcons([created]);
      await loadMotd(created);
      await loadBackups(created);
      await loadServerMeta(created);
      const defaultMotd = "Gamehost ONE server";
      setMotdDraft(defaultMotd);
      await saveMotd(defaultMotd, created);
      if (worldImportPayload) {
        setWizardWorldCopied(true);
      }
    } catch (err) {
      const message = String(err);
      setError(message);
      setUiToast({ tone: "error", message });
    } finally {
      setInstalling(false);
    }
  };

  const handleMigrationCreate = async (payload: MigrationCreatePayload) => {
    if (!isTauri) {
      throw new Error("Tauri runtime is not available.");
    }

    const created = await invoke<ServerConfig>("create_server", {
      config: {
        name: payload.name,
        serverType: payload.serverType,
        version: payload.version,
        ramGb: payload.ramGb,
        onlineMode: payload.onlineMode,
        port: 25565,
        worldImport: payload.worldImport,
        modImport: payload.modImport ?? null
      }
    });

    setServers((prev) => [...prev, created]);
    setSelectedServer(created);
    setServerSettingsByName((prev) => ({ ...prev, [created.name]: DEFAULT_SETTINGS }));
    changeView("servers");
    await loadServerIcons([created]);
    await loadMotd(created);
    await loadBackups(created);
    await loadServerMeta(created);
    const defaultMotd = "Gamehost ONE server";
    setMotdDraft(defaultMotd);
    await saveMotd(defaultMotd, created);
  };

  const sendCommand = async (command: string) => {
    if (!command.trim()) return;
    if (!isTauri) return;
    if (!selectedServer || selectedServer.name !== activeServerId) {
      setUiToast({ tone: "error", message: "Select the running server to send commands." });
      return;
    }
    try {
      await invoke("send_console_command", { serverId: selectedServer.name, command });
      setCommandInput("");
    } catch (err) {
      const message = String(err);
      setError(message);
      setUiToast({ tone: "error", message });
    }
  };

  const refreshNetwork = async () => {
    if (!isTauri) return;
    try {
      const port = selectedServer?.port ?? 25565;
      const info = await invoke<NetworkInfo>("get_network_info", { port });
      setNetwork(info);
    } catch (err) {
      const message = String(err);
      setError(message);
      setUiToast({ tone: "error", message });
    }
  };

  const runServerAction = async (action: "start" | "stop" | "restart", server: ServerConfig) => {
    if (action === "start") {
      if (activeServerId && activeServerId !== server.name) {
        setUiToast({ tone: "error", message: "Only one server can run at a time." });
        return;
      }
      await invoke("start_server", { serverId: server.name });
      setActiveServerId(server.name);
      return;
    }

    if (action === "restart") {
      if (activeServerId && activeServerId !== server.name) {
        setUiToast({ tone: "error", message: "Only one server can run at a time." });
        return;
      }
      await invoke("restart_server", { serverId: server.name });
      setActiveServerId(server.name);
      return;
    }

    await invoke("stop_server", { serverId: server.name });
    setActiveServerId(null);
  };

  const ensureJavaAndRun = async (action: "start" | "restart", server: ServerConfig) => {
    const result = await invoke<JavaStatusResult>("check_java", { serverVersion: server.version });
    setJavaStatus(result);
    if (result.status === "ready") {
      await runServerAction(action, server);
      return;
    }
    setPendingJavaAction({ action, server });
    setJavaModalOpen(true);
  };

  const handleServerAction = async (action: "start" | "stop" | "restart", target?: ServerConfig | null) => {
    if (!isTauri) return;
    const server = target ?? selectedServer;
    if (!server) return;
    setError(null);
    try {
      if (action === "start" || action === "restart") {
        await ensureJavaAndRun(action, server);
        return;
      }
      await runServerAction(action, server);
    } catch (err) {
      const message = String(err);
      setError(message);
      setUiToast({ tone: "error", message });
    }
  };

  const launchMinecraft = async (choice: LauncherChoice) => {
    if (!isTauri) return;
    try {
      await launchMinecraftClient(
        choice,
        selectedServer?.version ?? null,
        selectedServer?.name ?? null
      );
      setLauncherOpenedAt(Date.now());
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const handleOpenLauncherOnly = async () => {
    if (!launcherChoice) {
      setLauncherChoiceOpen(true);
      return;
    }
    if (!isTauri) return;
    try {
      await launchMinecraftClient(launcherChoice, null, null);
      setLauncherOpenedAt(Date.now());
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const handleLaunchMinecraft = async () => {
    if (!launcherChoice) {
      setLauncherChoiceOpen(true);
      return;
    }
    if (!isTauri) return;
    if (!selectedServer) {
      await launchMinecraft(launcherChoice);
      return;
    }

    const modsEnabled = selectedServer.server_type === "forge" || selectedServer.server_type === "fabric";
    const rawSyncMode = effectiveAppSettings.mod_sync_mode ?? "ask";
    const syncMode = rawSyncMode === "copy" ? "metadata" : rawSyncMode;
    if (modsEnabled) {
      if (syncMode === "ask") {
        setModSyncChoiceRemember(false);
        setModSyncChoiceError(null);
        setPendingLaunchAfterSync(true);
        setModSyncChoiceOpen(true);
        return;
      }
      try {
        if (syncMode === "metadata") {
          await syncModsWithMetadata(selectedServer);
          if (rawSyncMode === "copy") {
            await saveAppSettings({ ...effectiveAppSettings, mod_sync_mode: "metadata" });
          }
        }
      } catch (err) {
        setModSyncChoiceError(String(err));
        setModSyncChoiceOpen(true);
        return;
      }
    }

    await performLaunchForServer(selectedServer);
  };

  const handleChooseLauncher = async (choice: LauncherChoice) => {
    setLauncherChoice(choice);
    setLauncherChoiceOpen(false);
    await launchMinecraft(choice);
  };

  const handlePickLauncherPath = async () => {
    if (!isTauri) return;
    const selection = await open({
      multiple: false,
      filters: [{ name: "Launcher", extensions: ["exe"] }]
    });
    if (!selection || Array.isArray(selection)) return;
    await saveAppSettings({
      ...effectiveAppSettings,
      launcher_path: selection
    });
  };

  const handleClearLauncherPath = async () => {
    if (!isTauri) return;
    await saveAppSettings({
      ...effectiveAppSettings,
      launcher_path: null
    });
  };

  const handleDownloadMissingMods = async () => {
    if (!selectedServer || !isTauri) return;
    const missingIds = (modSync?.mods ?? [])
      .filter((entry) => entry.status === "missing")
      .map((entry) => entry.id);
    const hasUnknown = Boolean(modSync?.mods?.some((entry) => entry.status === "unknown"));
    const hasConflict = Boolean(modSync?.mods?.some((entry) => entry.status === "conflict"));
    if (missingIds.length === 0) {
      if (hasConflict) {
        setUiToast({ tone: "error", message: "Mods conflict detected." });
      } else if (hasUnknown) {
        setUiToast({ tone: "error", message: "Client mods not detected. Sync is unavailable." });
      } else {
        setUiToast({ tone: "success", message: "Mods are already in sync." });
      }
      return;
    }
    setModSyncLoading(true);
    try {
      await invoke("download_mods", { serverId: selectedServer.name, modIds: missingIds });
      await refreshModSync(selectedServer);
      setUiToast({ tone: "success", message: "Mods downloaded." });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setModSyncLoading(false);
    }
  };

  const fetchModSyncStatus = async (server: ServerConfig) => {
    if (!isTauri) return null;
    const sync = await invoke<ModSyncStatus>("check_mod_sync", { serverId: server.name });
    setModSync(sync);
    return sync;
  };

  const syncModsWithMetadata = async (server: ServerConfig) => {
    const sync = await fetchModSyncStatus(server);
    const missingIds = (sync?.mods ?? [])
      .filter((entry) => entry.status === "missing")
      .map((entry) => entry.id);
    if (missingIds.length === 0) {
      return;
    }
    await invoke("download_mods", { serverId: server.name, modIds: missingIds });
    await refreshModSync(server);
  };

  const performLaunchForServer = async (server: ServerConfig) => {
    if (!launcherChoice) {
      setLauncherChoiceOpen(true);
      return;
    }
    if (!isTauri) return;
    const required = resolveRequiredClient(server, serverMetadata);
    if (required.loader !== "vanilla") {
      setLoaderInstallOpen(true);
      setLoaderInstallBusy(true);
      setLoaderInstallError(null);
      try {
        const installed = await ensureClientLoaderInstalled(required);
        await createLauncherProfile(installed.versionId, server.name);
        await launchMinecraftClient(launcherChoice, installed.versionId, server.name);
        setLauncherOpenedAt(Date.now());
      } catch (err) {
        setLoaderInstallError(String(err));
        setLoaderInstallBusy(false);
        return;
      }
      setLoaderInstallBusy(false);
      setLoaderInstallOpen(false);
      return;
    }
    await launchMinecraftClient(launcherChoice, required.versionId, server.name);
    setLauncherOpenedAt(Date.now());
  };

  const handleJoinServer = async () => {
    if (!selectedServer) return;
    if (!launcherChoice) {
      setLauncherChoiceOpen(true);
      return;
    }
    if (!isTauri) return;
    const required = resolveRequiredClient(selectedServer, serverMetadata);
    if (required.loader !== "vanilla") {
      setLoaderInstallOpen(true);
      setLoaderInstallBusy(true);
      setLoaderInstallError(null);
      try {
        const installed = await ensureClientLoaderInstalled(required);
        await createLauncherProfile(installed.versionId, selectedServer.name);
        await launchMinecraftClient(launcherChoice, installed.versionId, selectedServer.name);
        setLauncherOpenedAt(Date.now());
      } catch (err) {
        setLoaderInstallError(String(err));
        setLoaderInstallBusy(false);
        return;
      }
      setLoaderInstallBusy(false);
      setLoaderInstallOpen(false);
    } else if (!clientStatus?.running) {
      await launchMinecraft(launcherChoice);
    }
    const address = await resolveServerAddress(selectedServer);
    try {
      await navigator.clipboard?.writeText(address);
    } catch {
      // Ignore clipboard errors and still show helper.
    }
    setUiToast({ tone: "success", message: "Server IP copied to clipboard" });
    setJoinIp(address);
    setJoinHelpOpen(true);
  };

  const handleInviteFriends = async () => {
    if (!selectedServer) return;
    const address = await resolveServerAddress(selectedServer);
    try {
      await navigator.clipboard?.writeText(address);
    } catch {
      // Ignore clipboard errors and still show helper.
    }
    setUiToast({ tone: "success", message: "Server IP copied to clipboard" });
    setJoinIp(address);
    setJoinHelpOpen(true);
  };

  const resolveServerAddress = async (server: ServerConfig) => {
    let ip = network?.local_ip ?? "127.0.0.1";
    try {
      const info = await invoke<NetworkInfo>("get_network_info", { port: server.port });
      setNetwork(info);
      ip = info.local_ip;
    } catch {
      // Ignore and fall back to existing IP.
    }
    return `${ip}:${server.port}`;
  };

  const handleOpenForgeDownload = async () => {
    const url = getForgeDownloadUrl(selectedServer?.version ?? null);
    if (!url) return;
    try {
      await openUrl(url);
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const openClientModsFolder = async () => {
    try {
      const base = await dataDir();
      const modsDir = await join(base, ".minecraft", "mods");
      if (await exists(modsDir)) {
        await openPath(modsDir);
      } else {
        const minecraftDir = await join(base, ".minecraft");
        await openPath(minecraftDir);
      }
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const handleSyncModsCheck = async () => {
    if (!selectedServer) return;
    await refreshModSync(selectedServer);
  };

  const handleDownloadJava = async () => {
    if (!isTauri || !pendingJavaAction) return;
    setJavaBusy(true);
    setJavaDownloadProgress(0);
    try {
      const result = await invoke<JavaStatusResult>("download_java", {
        serverVersion: pendingJavaAction.server.version
      });
      setJavaStatus(result);
      if (result.status === "ready") {
        setJavaModalOpen(false);
        await runServerAction(pendingJavaAction.action, pendingJavaAction.server);
        setPendingJavaAction(null);
      }
    } catch (err) {
      const message = String(err);
      setUiToast({ tone: "error", message });
    } finally {
      setJavaBusy(false);
      setJavaDownloadProgress(null);
    }
  };

  const handleSelectJava = async () => {
    if (!isTauri || !pendingJavaAction) return;
    const selection = await open({
      multiple: false,
      filters: [{ name: "Java", extensions: ["exe"] }]
    });
    if (!selection || Array.isArray(selection)) return;

    setJavaBusy(true);
    try {
      const result = await invoke<JavaStatusResult>("set_java_path", {
        javaPath: selection,
        serverVersion: pendingJavaAction.server.version
      });
      setJavaStatus(result);
      if (result.status === "ready") {
        setJavaModalOpen(false);
        await runServerAction(pendingJavaAction.action, pendingJavaAction.server);
        setPendingJavaAction(null);
      }
    } catch (err) {
      const message = String(err);
      setUiToast({ tone: "error", message });
    } finally {
      setJavaBusy(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!selectedServer || !isTauri) return;
    setConfigSaving(true);
    try {
      const result = await invoke<ApplyResult>("update_server_config", {
        payload: {
          serverId: selectedServer.name,
          ramGb: ramDraft,
          onlineMode: onlineModeDraft
        }
      });
      setServers((prev) =>
        prev.map((server) =>
          server.name === selectedServer.name
            ? { ...server, ram_gb: ramDraft, online_mode: onlineModeDraft }
            : server
        )
      );
      setSelectedServer((prev) =>
        prev ? { ...prev, ram_gb: ramDraft, online_mode: onlineModeDraft } : prev
      );

      if (result.pending_restart) {
        setUiToast({ tone: "success", message: "Settings saved. Restart required." });
      } else {
        setUiToast({ tone: "success", message: "Settings applied." });
      }
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setConfigSaving(false);
    }
  };

  const handleApplyRam = async () => {
    if (!selectedServer || !isTauri) return;
    setConfigSaving(true);
    try {
      const isRunning = serverStatusFor(selectedServer) === "RUNNING";
      if (isRunning) {
        await invoke<BackupEntry>("create_backup", {
          serverId: selectedServer.name,
          includeNether: backupIncludeNether,
          includeEnd: backupIncludeEnd,
          reason: "ram_change"
        });
        await runServerAction("stop", selectedServer);
      }

      const result = await invoke<ApplyResult>("update_server_config", {
        payload: {
          serverId: selectedServer.name,
          ramGb: ramDraft,
          onlineMode: onlineModeDraft
        }
      });

      setServers((prev) =>
        prev.map((server) =>
          server.name === selectedServer.name
            ? { ...server, ram_gb: ramDraft, online_mode: onlineModeDraft }
            : server
        )
      );
      setSelectedServer((prev) =>
        prev ? { ...prev, ram_gb: ramDraft, online_mode: onlineModeDraft } : prev
      );

      if (isRunning) {
        await runServerAction("start", selectedServer);
      }

      if (result.pending_restart && !isRunning) {
        setUiToast({ tone: "success", message: "RAM saved. Restart required." });
      } else {
        setUiToast({ tone: "success", message: "RAM applied." });
      }
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setConfigSaving(false);
    }
  };

  const handleReinstallServer = async () => {
    if (!selectedServer || !isTauri) return;
    setReinstallBusy(true);
    try {
      const updated = await invoke<ServerConfig>("reinstall_server", {
        serverId: selectedServer.name,
        serverType: reinstallType,
        version: reinstallVersion
      });
      setServers((prev) =>
        prev.map((server) => (server.name === selectedServer.name ? updated : server))
      );
      setSelectedServer(updated);
      if (activeServerId === selectedServer.name) {
        setActiveServerId(null);
      }
      setStatus("STOPPED");
      setUiToast({ tone: "success", message: "Server reinstalled." });
      await loadMods(updated);
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setReinstallBusy(false);
    }
  };

  const handleCreateBackup = async () => {
    if (!selectedServer || !isTauri) return;
    setBackupProgress(0);
    try {
      await invoke<BackupEntry>("create_backup", {
        serverId: selectedServer.name,
        includeNether: backupIncludeNether,
        includeEnd: backupIncludeEnd,
        reason: "manual"
      });
      await loadBackups(selectedServer);
      setUiToast({ tone: "success", message: "Backup created." });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setBackupProgress(null);
    }
  };

  const handleExportWorld = async () => {
    if (!selectedServer || !isTauri) return;
    const destination = await save({
      filters: [{ name: "Zip", extensions: ["zip"] }],
      defaultPath: `${selectedServer.name}-world.zip`
    });
    if (!destination) return;
    setExportProgress(0);
    try {
      await invoke("export_world", {
        serverId: selectedServer.name,
        destination,
        includeNether: backupIncludeNether,
        includeEnd: backupIncludeEnd
      });
      setUiToast({ tone: "success", message: "World exported." });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setExportProgress(null);
    }
  };

  const handleOpenBackupsFolder = async () => {
    if (!selectedServer) return;
    try {
      const base = appDataPath ?? (await appDataDir());
      const backupsDir = await join(base, "backups", selectedServer.name);
      if (await exists(backupsDir)) {
        await openPath(backupsDir);
      } else {
        await openPath(base);
      }
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const handleRestoreBackup = async (entry: BackupEntry) => {
    if (!selectedServer || !isTauri) return;
    let ok = false;
    try {
      ok = await confirm("Restore this backup? Current world will be replaced.", {
        title: "Restore backup"
      });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
      return;
    }
    if (!ok) return;
    try {
      await invoke("restore_backup", { serverId: selectedServer.name, backupId: entry.id });
      setUiToast({ tone: "success", message: "Backup restored." });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const handleDeleteBackup = async (entry: BackupEntry) => {
    if (!selectedServer || !isTauri) return;
    let ok = false;
    try {
      ok = await confirm("Delete this backup? This cannot be undone.", {
        title: "Delete backup"
      });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
      return;
    }
    if (!ok) return;
    try {
      await invoke("delete_backup", { serverId: selectedServer.name, backupId: entry.id });
      await loadBackups(selectedServer);
      setUiToast({ tone: "success", message: "Backup deleted." });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const handleDeleteServer = async (target?: ServerConfig | null) => {
    const activeTarget = target ?? deleteTarget;
    if (!activeTarget || !isTauri) return;
    setDeleteBusy(true);
    try {
      await invoke("delete_server", { serverId: activeTarget.name });
      setServers((prev) => prev.filter((server) => server.name !== activeTarget.name));
      setServerIcons((prev) => {
        const next = { ...prev };
        delete next[activeTarget.name];
        return next;
      });
      if (selectedServer?.name === activeTarget.name) {
        setSelectedServer(null);
      }
      if (activeServerId === activeTarget.name) {
        setActiveServerId(null);
      }
      changeView("servers");
      setUiToast({ tone: "success", message: "Server deleted." });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setDeleteBusy(false);
      setDeleteTarget(null);
      setDeleteConfirm("");
    }
  };

  const loadMods = async (server: ServerConfig) => {
    if (!isTauri) return;
    setModsLoading(true);
    try {
      const list = await invoke<ModEntry[]>("list_mods", { serverId: server.name });
      setMods(list);
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
      setMods([]);
    } finally {
      setModsLoading(false);
    }
  };

  const loadModpack = async (server: ServerConfig) => {
    if (!isTauri) return;
    try {
      const pack = await invoke<ModpackManifest>("get_modpack", { serverId: server.name });
      setModpack(pack);
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
      setModpack(null);
    }
  };

  const refreshModSync = async (server: ServerConfig) => {
    if (!isTauri) return;
    setModSyncLoading(true);
    try {
      const sync = await invoke<ModSyncStatus>("check_mod_sync", { serverId: server.name });
      setModSync(sync);
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
      setModSync(null);
    } finally {
      setModSyncLoading(false);
    }
  };

  const refreshClientStatus = async () => {
    if (!isTauri) return;
    setClientChecking(true);
    try {
      const status = await detectClient();
      setClientStatus(status);
    } catch {
      setClientStatus({ running: false, versionId: null, mcVersion: null, loader: null, pid: null });
    } finally {
      setClientChecking(false);
    }
  };

  const loadBackups = async (server: ServerConfig) => {
    if (!isTauri) return;
    setBackupsLoading(true);
    try {
      const list = await invoke<BackupEntry[]>("list_backups", { serverId: server.name });
      setBackups(list.sort((a, b) => b.created_at.localeCompare(a.created_at)));
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
      setBackups([]);
    } finally {
      setBackupsLoading(false);
    }
  };

  const loadServerMeta = async (server: ServerConfig) => {
    if (!isTauri) return;
    try {
      const meta = await invoke<ServerMeta>("get_server_meta", { serverId: server.name });
      setServerMeta(meta);
    } catch {
      setServerMeta({ auto_backup: false, backup_interval_minutes: 60, last_backup_at: null });
    }
  };

  const saveServerMeta = async (next: ServerMeta) => {
    if (!selectedServer || !isTauri) return;
    setServerMeta(next);
    try {
      await invoke("update_server_meta", {
        serverId: selectedServer.name,
        meta: {
          autoBackup: next.auto_backup,
          backupIntervalMinutes: next.backup_interval_minutes,
          lastBackupAt: next.last_backup_at ?? null
        }
      });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const handleImportPick = async () => {
    if (!isTauri) return;
    const selection = await open({ directory: true, multiple: false });
    if (!selection || Array.isArray(selection)) return;
    setImportPath(selection);
    setImportAnalysis(null);
    setImportName("");
    try {
      const analysis = await invoke<ImportAnalysis>("analyze_server_folder_cmd", { sourcePath: selection });
      setImportAnalysis(analysis);
      setImportName(analysis.suggested_name);
      setImportMode("copy");
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const handleImportServer = async () => {
    if (!importPath || !importName.trim() || !isTauri) return;
    setImportBusy(true);
    try {
      const created = await invoke<ServerConfig>("import_server", {
        sourcePath: importPath,
        name: importName.trim(),
        mode: importMode
      });
      setServers((prev) => [...prev, created]);
      setSelectedServer(created);
      changeView("servers");
      setImportOpen(false);
      setImportPath(null);
      setImportAnalysis(null);
      await loadServerIcons([created]);
      await loadMotd(created);
      await loadBackups(created);
      await loadServerMeta(created);
      setUiToast({ tone: "success", message: "Server imported." });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setImportBusy(false);
    }
  };

  const handleModDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!selectedServer || !isTauri) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    if (files.length > 1) {
      setUiToast({ tone: "error", message: "Add mods one at a time to attach metadata." });
      return;
    }

    const filePath = (files[0] as File & { path?: string }).path;
    if (!filePath) {
      setUiToast({ tone: "error", message: "Cannot read file path for dropped mod." });
      return;
    }

    const fileName = files[0].name.replace(/\.jar$/i, "");
    setModMetaPath(filePath);
    setModMetaId(fileName);
    setModMetaVersion("");
    setModMetaUrl("");
    setModMetaError(null);
    setModMetaOpen(true);
  };

  const handleToggleMod = async (entry: ModEntry) => {
    if (!selectedServer || !isTauri) return;
    try {
      await invoke("toggle_mod", {
        serverId: selectedServer.name,
        fileName: entry.file_name,
        enabled: !entry.enabled
      });
      await loadMods(selectedServer);
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const handleDeleteAllMods = async () => {
    if (!selectedServer || !isTauri) return;
    const ok = await confirm("Delete all mods from this server? This cannot be undone.", {
      title: "Delete all mods"
    });
    if (!ok) return;
    setModsBulkBusy(true);
    try {
      const deleted = await invoke<number>("delete_all_mods", { serverId: selectedServer.name });
      await loadMods(selectedServer);
      setUiToast({ tone: "success", message: `Deleted ${deleted} mods.` });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setModsBulkBusy(false);
    }
  };

  const handleAddModWithMeta = async () => {
    if (!selectedServer || !isTauri || !modMetaPath) return;
    setModMetaBusy(true);
    setModMetaError(null);
    try {
      const manifest = await invoke<ModpackManifest>("add_mod_with_meta", {
        serverId: selectedServer.name,
        sourcePath: modMetaPath,
        modId: modMetaId,
        modVersion: modMetaVersion,
        url: modMetaUrl
      });
      setModpack(manifest);
      setModMetaOpen(false);
      setModMetaPath(null);
      await loadMods(selectedServer);
      await refreshModSync(selectedServer);
      setUiToast({ tone: "success", message: "Mod added." });
    } catch (err) {
      const message = String(err);
      setModMetaError(message);
      setUiToast({ tone: "error", message });
    } finally {
      setModMetaBusy(false);
    }
  };

  const handleOpenServer = (server: ServerConfig) => {
    setSelectedServer(server);
    changeView("detail");
  };

  const serverStatusFor = (server: ServerConfig) => {
    if (activeServerId && server.name === activeServerId) {
      return normalizedStatus;
    }
    return "STOPPED" as const;
  };

  const overviewStatus = selectedServer ? serverStatusFor(selectedServer) : "STOPPED";
  const overviewAction = getActionState(overviewStatus as ServerStatus);
  const serverReady = overviewStatus === "RUNNING";
  const serverLoader = serverMetadata?.loader ??
    (selectedServer
      ? selectedServer.server_type === "forge"
        ? "forge"
        : selectedServer.server_type === "fabric"
        ? "fabric"
        : "vanilla"
      : "vanilla");
  const forgeInstallersVisible =
    serverLoader === "forge" && (serverMetadata?.modCount ?? 0) > 0;
  const clientLoader = clientStatus?.loader ?? "vanilla";
  const clientVersion = clientStatus?.mcVersion ?? null;
  const comparison = compareClientToServer(clientStatus, selectedServer);
  const versionMismatch = Boolean(selectedServer && clientStatus?.running && !comparison.versionMatch);
  const loaderMismatch = Boolean(selectedServer && clientStatus?.running && !comparison.loaderMatch);
  const supportsMods = Boolean(
    selectedServer && (selectedServer.server_type === "forge" || selectedServer.server_type === "fabric")
  );
  const modMismatch = Boolean(
    supportsMods && modSync?.mods?.some((entry) => entry.status === "missing" || entry.status === "conflict")
  );
  const isCompatible = Boolean(
    clientStatus?.running && serverReady && !versionMismatch && !loaderMismatch && !modMismatch
  );

  useEffect(() => {
    if (!clientStatus?.running) {
      setClientMismatchDismissed(false);
      setClientMismatchOpen(false);
      return;
    }
    const mismatch = versionMismatch || loaderMismatch;
    if (!mismatch) {
      setClientMismatchDismissed(false);
      setClientMismatchOpen(false);
      return;
    }
    if (!clientMismatchDismissed) {
      setClientMismatchOpen(true);
    }
  }, [clientStatus, versionMismatch, loaderMismatch, clientMismatchDismissed]);

  const openAppData = async () => {
    const targetPath = appDataPath ?? "C:\\Users\\Adam\\AppData\\Roaming\\com.gamehost.one";
    try {
      await openPath(targetPath);
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const loadAppSettings = async () => {
    if (!isTauri) return;
    try {
      const settings = await invoke<AppSettings>("get_app_settings");
      setAppSettings(settings);
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const saveAppSettings = async (next: AppSettings) => {
    if (!isTauri) return;
    setAppSettingsSaving(true);
    try {
      const saved = await invoke<AppSettings>("update_app_settings", { settings: next });
      setAppSettings(saved);
      setUiToast({ tone: "success", message: "Settings saved." });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setAppSettingsSaving(false);
    }
  };

  const handleCheckUpdates = async (silent?: boolean) => {
    if (!isTauri) return;
    setUpdateChecking(true);
    setUpdateError(null);
    try {
      const info = await invoke<UpdateInfo>("check_for_updates", { repo: UPDATE_REPO });
      setUpdateInfo(info);
      if (info.update_available) {
        setUpdateModalOpen(true);
      } else if (!silent) {
        setUiToast({ tone: "success", message: "You are up to date." });
      }
    } catch (err) {
      const message = String(err);
      setUpdateError(message);
      if (!silent) {
        setUiToast({ tone: "error", message });
      }
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleUpdateNow = async () => {
    if (!isTauri || !updateInfo?.download_url) return;
    setUpdateDownloading(true);
    setUpdateError(null);
    try {
      const path = await invoke<string>("download_update", { downloadUrl: updateInfo.download_url });
      await openPath(path);
      setUpdateModalOpen(false);
      setUiToast({ tone: "success", message: "Installer opened." });
    } catch (err) {
      const message = String(err);
      setUpdateError(message);
      setUiToast({ tone: "error", message });
    } finally {
      setUpdateDownloading(false);
    }
  };

  const loadCrashReports = async () => {
    if (!isTauri) return;
    try {
      const reports = await invoke<CrashReportSummary[]>("list_crash_reports");
      setCrashReports(reports);
      if (reports.length > 0) {
        setCrashModalOpen(true);
      }
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const handleExportCrashReports = async () => {
    if (!isTauri) return;
    if (crashReports.length === 0) {
      setUiToast({ tone: "error", message: "No crash reports to export." });
      return;
    }
    try {
      const target = await save({
        title: "Export crash reports",
        defaultPath: "crash-reports.zip",
        filters: [{ name: "Zip archive", extensions: ["zip"] }]
      });
      if (!target || Array.isArray(target)) return;
      const path = await invoke<string>("export_crash_reports", { destination: target });
      await openPath(path);
      setUiToast({ tone: "success", message: "Crash reports exported." });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const openCrashReport = async (fileName: string) => {
    if (!isTauri) return;
    setCrashLoading(true);
    try {
      const report = await invoke<CrashReport>("get_crash_report", { fileName });
      setActiveCrashReport(report);
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setCrashLoading(false);
    }
  };

  const deleteCrashReport = async (fileName: string) => {
    if (!isTauri) return;
    try {
      await invoke("delete_crash_report", { fileName });
      setCrashReports((prev) => prev.filter((report) => report.file_name !== fileName));
      if (activeCrashReport) {
        setActiveCrashReport(null);
      }
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const clearCrashReports = async () => {
    if (!isTauri) return;
    try {
      await invoke("clear_crash_reports");
      setCrashReports([]);
      setActiveCrashReport(null);
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    }
  };

  const loadServerIcons = async (list: ServerConfig[]) => {
    if (!isTauri) return;
    const entries = await Promise.all(
      list.map(async (server) => {
        const iconPath = await join(server.server_dir, "server-icon.png");
        const hasIcon = await exists(iconPath);
        if (!hasIcon) return [server.name, "/logo.png"] as const;
        try {
          const bytes = await readFile(iconPath);
          const blob = new Blob([bytes], { type: "image/png" });
          const url = URL.createObjectURL(blob);
          return [server.name, url] as const;
        } catch {
          return [server.name, "/logo.png"] as const;
        }
      })
    );
    setServerIcons((prev) => {
      for (const [name, nextUrl] of entries) {
        const prevUrl = prev[name];
        if (prevUrl && prevUrl.startsWith("blob:") && prevUrl !== nextUrl) {
          URL.revokeObjectURL(prevUrl);
        }
      }
      return { ...prev, ...Object.fromEntries(entries) };
    });
  };

  const loadMotd = async (server: ServerConfig) => {
    if (!isTauri) return;
    try {
      const propertiesPath = await join(server.server_dir, "server.properties");
      const content = await readTextFile(propertiesPath);
      const motdLine = content
        .split(/\r?\n/)
        .find((line) => line.startsWith("motd="))
        ?.replace("motd=", "");
      const cleaned = motdLine?.replace(/§bONE§r/g, "ONE");
      setMotdDraft(String(cleaned ?? "Gamehost ONE server"));
    } catch {
      setMotdDraft("Gamehost ONE server");
    }
  };

  const saveMotd = async (value?: string, targetServer?: ServerConfig) => {
    const server = targetServer ?? selectedServer;
    if (!server || !isTauri) return;
    const motdValue = String(value ?? motdDraft ?? "");
    setMotdSaving(true);
    try {
      const propertiesPath = await join(server.server_dir, "server.properties");
      const content = await readTextFile(propertiesPath);
      const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
      const formatted = motdValue.replace(/ONE/g, "§bONE§r");
      const updatedLines = lines.some((line) => line.startsWith("motd="))
        ? lines.map((line) => (line.startsWith("motd=") ? `motd=${formatted}` : line))
        : [...lines, `motd=${formatted}`];
      await writeTextFile(propertiesPath, `${updatedLines.join("\n")}\n`);
      setUiToast({ tone: "success", message: "MOTD saved." });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setMotdSaving(false);
    }
  };

  const handleIconUpload = async (server: ServerConfig) => {
    if (!isTauri) return;
    const selection = await open({
      title: "Select server icon",
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
      fileAccessMode: "copy"
    });
    if (!selection || Array.isArray(selection)) return;

    setIconSaving(true);
    try {
      const fileBytes = await readFile(selection);
      const blob = new Blob([fileBytes]);
      const url = URL.createObjectURL(blob);
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(image, 0, 0, 64, 64);

      const outputBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Icon encode failed"))), "image/png");
      });
      URL.revokeObjectURL(url);

      const outputBytes = new Uint8Array(await outputBlob.arrayBuffer());
      const iconPath = await join(server.server_dir, "server-icon.png");
      await writeFile(iconPath, outputBytes);
      await loadServerIcons([server]);
      setUiToast({ tone: "success", message: "Server icon updated." });
    } catch (err) {
      setUiToast({ tone: "error", message: String(err) });
    } finally {
      setIconSaving(false);
    }
  };

  const showSidebar = view !== "loading";
  const isServerView = view === "detail";
  const activeTutorialStep = tutorialActive ? TUTORIAL_STEPS[tutorialStepIndex] : null;
  const changeView = (next: View) => startViewTransition(() => setView(next));
  const changeDetailTab = (next: string) => startViewTransition(() => setDetailTab(next));

  const stopTutorial = (options?: { neverShow?: boolean }) => {
    if (options?.neverShow) {
      setShowTutorialOnStartup(false);
      window.localStorage.setItem("gho_show_tutorial", "false");
    }
    setTutorialActive(false);
    setTutorialStepIndex(0);
    window.localStorage.setItem("gho_tutorial_done", "true");
  };

  const nextTutorial = () => {
    if (tutorialStepIndex >= TUTORIAL_STEPS.length - 1) {
      stopTutorial();
    } else {
      setTutorialStepIndex((prev) => prev + 1);
    }
  };

  const prevTutorial = () => {
    setTutorialStepIndex((prev) => Math.max(0, prev - 1));
  };


  return (
    <div className={classNames("window-root", isMaximized && "window-root-max")}>
      <div
        className={classNames(
          "app-root flex h-full min-h-full flex-col text-text",
          view === "loading" && "overflow-hidden",
          isMaximized && "maximized"
        )}
      >
        <TitleBar uiToast={uiToast} onMinimize={handleMinimize} onMaximize={handleMaximize} onClose={handleClose} />

        {serverReady && effectiveAppSettings.smart_join_panel_enabled && !smartJoinDismissed && (
          <motion.div
            variants={item}
            className="fixed bottom-6 right-6 z-40 w-full max-w-xs rounded-3xl border border-white/10 bg-surface/95 p-4 text-sm text-text shadow-soft"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <img src="/MC-logo.webp" alt="Minecraft" className="h-8 w-8 object-contain" />
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">Minecraft</p>
                  <p className="text-sm font-semibold text-text">Server is running</p>
                </div>
              </div>
              <button
                className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
                onClick={() => setSmartJoinDismissed(true)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <PrimaryButton onClick={handleJoinServer}>
                Join Server
              </PrimaryButton>
              <SubtleButton onClick={handleInviteFriends}>
                Invite Friends
              </SubtleButton>
            </div>
          </motion.div>
        )}


        <div className="flex flex-1 min-h-0">
          {showSidebar && (
            <Sidebar
              view={view}
              setView={changeView}
              sidebarExpanded={sidebarExpanded}
              setSidebarExpanded={setSidebarExpanded}
              servers={servers}
              selectedServer={selectedServer}
              isServerView={isServerView}
              serverIcons={serverIcons}
              serverStatusFor={serverStatusFor}
              handleOpenServer={handleOpenServer}
            />
          )}
          <div className="content-scroll flex-1 min-h-0 overflow-y-auto px-6 pb-12 pt-8 lg:px-12">
          {fatalError && (
            <div className="fixed inset-x-0 top-6 z-50 mx-auto flex max-w-3xl items-center justify-center px-4">
              <div className="w-full rounded-3xl border border-danger/30 bg-danger/15 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-danger">UI error</p>
                    <p className="mt-2 text-sm text-text">{fatalError}</p>
                  </div>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
                    onClick={() => setFatalError(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}
          <DeleteServerModal
            target={deleteTarget}
            confirmText={deleteConfirm}
            deleteMatches={deleteMatches}
            deleteBusy={deleteBusy}
            onConfirmTextChange={setDeleteConfirm}
            onCancel={() => setDeleteTarget(null)}
            onDelete={() => handleDeleteServer()}
          />
          <ImportServerModal
            open={importOpen}
            importPath={importPath}
            importAnalysis={importAnalysis}
            importName={importName}
            importMode={importMode}
            importBusy={importBusy}
            onClose={() => setImportOpen(false)}
            onPick={handleImportPick}
            onNameChange={setImportName}
            onModeChange={setImportMode}
            onImport={handleImportServer}
          />
          {modMetaOpen && (
            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-4">
              <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface p-6 text-sm text-text shadow-soft">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Mod metadata</p>
                    <h3 className="mt-2 font-display text-xl text-text">Add mod metadata</h3>
                  </div>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
                    onClick={() => {
                      setModMetaOpen(false);
                      setModMetaPath(null);
                      setModMetaError(null);
                    }}
                  >
                    Close
                  </button>
                </div>
                <div className="mt-4 grid gap-3">
                  <div className="grid gap-2">
                    <label className="text-xs uppercase tracking-[0.2em] text-muted">Mod ID</label>
                    <input
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
                      value={modMetaId}
                      onChange={(event) => setModMetaId(event.target.value)}
                      placeholder="jei"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-xs uppercase tracking-[0.2em] text-muted">Version</label>
                    <input
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
                      value={modMetaVersion}
                      onChange={(event) => setModMetaVersion(event.target.value)}
                      placeholder="15.2.0"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-xs uppercase tracking-[0.2em] text-muted">Download URL</label>
                    <input
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
                      value={modMetaUrl}
                      onChange={(event) => setModMetaUrl(event.target.value)}
                      placeholder="https://cdn.modrinth.com/..."
                    />
                    <p className="text-xs text-muted">Only Modrinth or CurseForge CDN URLs are allowed.</p>
                  </div>
                  {modMetaError && <p className="text-xs text-danger">{modMetaError}</p>}
                </div>
                <div className="mt-5 flex items-center justify-end gap-3">
                  <SubtleButton
                    onClick={() => {
                      setModMetaOpen(false);
                      setModMetaPath(null);
                      setModMetaError(null);
                    }}
                  >
                    Cancel
                  </SubtleButton>
                  <PrimaryButton
                    onClick={handleAddModWithMeta}
                    disabled={
                      modMetaBusy ||
                      !modMetaId.trim() ||
                      !modMetaVersion.trim() ||
                      !modMetaUrl.trim()
                    }
                  >
                    {modMetaBusy ? "Adding..." : "Add mod"}
                  </PrimaryButton>
                </div>
              </div>
            </div>
          )}
          <JavaModal
            open={javaModalOpen}
            status={javaStatus}
            downloadProgress={javaDownloadProgress}
            busy={javaBusy}
            onClose={() => {
              setJavaModalOpen(false);
              setPendingJavaAction(null);
              setJavaDownloadProgress(null);
            }}
            onDownload={handleDownloadJava}
            onSelect={handleSelectJava}
          />
          <LauncherModal
            open={launcherChoiceOpen}
            onClose={() => setLauncherChoiceOpen(false)}
            onChoose={handleChooseLauncher}
            launcherPath={effectiveAppSettings.launcher_path ?? null}
            onPickLauncherPath={handlePickLauncherPath}
            onClearLauncherPath={handleClearLauncherPath}
          />
          {loaderInstallOpen && (
            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-6">
              <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-surface p-6 text-sm text-text shadow-soft">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Launcher</p>
                    <h3 className="mt-2 font-display text-xl text-text">
                      {loaderInstallBusy ? "Installing loader" : "Install failed"}
                    </h3>
                  </div>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
                    onClick={() => setLoaderInstallOpen(false)}
                    disabled={loaderInstallBusy}
                  >
                    Close
                  </button>
                </div>
                <div className="mt-4 grid gap-2 text-xs text-muted">
                  {loaderInstallBusy ? (
                    <p>Installing the required loader into your Minecraft launcher.</p>
                  ) : (
                    <p>{loaderInstallError ?? "Unable to install the loader."}</p>
                  )}
                </div>
                {!loaderInstallBusy && (
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <PrimaryButton
                      onClick={() => {
                        setLoaderInstallError(null);
                        setLoaderInstallOpen(false);
                      }}
                    >
                      Ok
                    </PrimaryButton>
                  </div>
                )}
              </div>
            </div>
          )}
          {clientMismatchOpen && selectedServer && clientStatus?.running && (
            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-6">
              <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-surface p-6 text-sm text-text shadow-soft">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Compatibility</p>
                    <h3 className="mt-2 font-display text-xl text-text">Incompatible client detected</h3>
                  </div>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
                    onClick={() => {
                      setClientMismatchOpen(false);
                      setClientMismatchDismissed(true);
                    }}
                  >
                    Close
                  </button>
                </div>
                <div className="mt-4 grid gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">Server</p>
                  <p className="text-sm text-text">
                    {formatLoaderLabel(serverLoader)} {serverMetadata?.mcVersion ?? selectedServer.version}
                  </p>
                </div>
                <div className="mt-3 grid gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">Client</p>
                  <p className="text-sm text-text">
                    {formatLoaderLabel(clientLoader)} {clientVersion ?? "unknown"}
                  </p>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <PrimaryButton onClick={handleLaunchMinecraft}>Launch correct version</PrimaryButton>
                  <SubtleButton
                    onClick={() => {
                      setClientMismatchDismissed(true);
                      handleOpenLauncherOnly();
                    }}
                  >
                    Open launcher
                  </SubtleButton>
                </div>
              </div>
            </div>
          )}
          {modSyncModalOpen && (
            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-6">
              <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-surface p-6 text-sm text-text shadow-soft">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Mod sync</p>
                    <h3 className="mt-2 font-display text-xl text-text">Mod list</h3>
                  </div>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
                    onClick={() => setModSyncModalOpen(false)}
                  >
                    Close
                  </button>
                </div>
                {modpack && (
                  <p className="mt-3 text-xs text-muted">
                    Modpack: {modpack.mcVersion} · {formatLoaderLabel(modpack.loader)} · {modpack.mods.length} mods
                  </p>
                )}
                {modSync?.mods?.some((entry) => entry.status === "unknown") && (
                  <p className="mt-2 text-xs text-muted">Some mods do not include sync metadata.</p>
                )}
                <div className="mt-4 max-h-[60vh] overflow-y-auto pr-2">
                  {modSync?.mods && modSync.mods.length > 0 ? (
                    <div className="grid gap-2">
                      {modSync.mods.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                        >
                          <div>
                            <p className="text-sm text-text">{entry.id}</p>
                            {entry.version !== "unknown" && (
                              <p className="text-xs text-muted">{entry.version}</p>
                            )}
                          </div>
                          {entry.status !== "unknown" && (
                            <span
                              className={classNames(
                                "rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
                                entry.status === "installed"
                                  ? "bg-secondary/20 text-secondary"
                                  : entry.status === "missing"
                                  ? "bg-amber-500/20 text-amber-200"
                                  : "bg-danger/20 text-danger"
                              )}
                            >
                              {entry.status}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted">No modpack data yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}
          {modsModalOpen && (
            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-6">
              <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-surface p-6 text-sm text-text shadow-soft">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Mods</p>
                    <h3 className="mt-2 font-display text-xl text-text">Installed mods</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <SubtleButton
                      onClick={handleDeleteAllMods}
                      className="text-danger"
                      disabled={modsLoading || modsBulkBusy}
                    >
                      Delete all
                    </SubtleButton>
                    <button
                      className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
                      onClick={() => setModsModalOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="mt-4 max-h-[60vh] overflow-y-auto pr-2">
                  {modsLoading ? (
                    <p className="text-xs text-muted">Loading mods...</p>
                  ) : mods.length === 0 ? (
                    <p className="text-xs text-muted">No mods installed yet.</p>
                  ) : (
                    <div className="grid gap-2">
                      {mods.map((entry) => (
                        <div
                          key={entry.file_name}
                          className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-2"
                        >
                          <div>
                            <p className="text-sm text-text">{entry.name}</p>
                            <p className="text-xs text-muted">{entry.enabled ? "Enabled" : "Disabled"}</p>
                          </div>
                          <SubtleButton onClick={() => handleToggleMod(entry)}>
                            {entry.enabled ? "Disable" : "Enable"}
                          </SubtleButton>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {joinHelpOpen && (
            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-6">
              <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-surface p-6 text-sm text-text shadow-soft">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Join server</p>
                    <h3 className="mt-2 font-display text-xl text-text">Server is ready.</h3>
                  </div>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
                    onClick={() => setJoinHelpOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <p className="mt-2 text-sm text-muted">IP copied to clipboard.</p>
                <div className="mt-4 grid gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">Server IP</p>
                  <p className="text-sm text-text">{joinIp ?? "-"}</p>
                </div>
                <div className="mt-4 grid gap-2 text-xs text-muted">
                  <p>Open Minecraft → Multiplayer → Add Server → Paste IP</p>
                </div>
              </div>
            </div>
          )}
          {modSyncChoiceOpen && selectedServer && (
            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-6">
              <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface p-6 text-sm text-text shadow-soft">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Mods</p>
                    <h3 className="mt-2 font-display text-xl text-text">Sync mods before launch</h3>
                  </div>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
                    onClick={() => {
                      setModSyncChoiceOpen(false);
                      setPendingLaunchAfterSync(false);
                    }}
                    disabled={modSyncChoiceBusy}
                  >
                    Close
                  </button>
                </div>
                <div className="mt-4 grid gap-2 text-xs text-muted">
                  <p>Choose how to sync mods for this server.</p>
                  <p>Requires modpack metadata (ID + URL) to download client mods.</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <SubtleButton onClick={openClientModsFolder} disabled={modSyncChoiceBusy}>
                    Open client mods folder
                  </SubtleButton>
                </div>
                {modSyncChoiceError && <p className="mt-3 text-xs text-danger">{modSyncChoiceError}</p>}
                <div className="mt-5 grid gap-2">
                  <PrimaryButton
                    onClick={async () => {
                      if (!selectedServer) return;
                      setModSyncChoiceBusy(true);
                      setModSyncChoiceError(null);
                      try {
                        await syncModsWithMetadata(selectedServer);
                        if (modSyncChoiceRemember) {
                          await saveAppSettings({ ...effectiveAppSettings, mod_sync_mode: "metadata" });
                        }
                        setModSyncChoiceBusy(false);
                        setModSyncChoiceOpen(false);
                        if (pendingLaunchAfterSync) {
                          setPendingLaunchAfterSync(false);
                          await performLaunchForServer(selectedServer);
                        }
                      } catch (err) {
                        setModSyncChoiceError(String(err));
                        setModSyncChoiceBusy(false);
                      }
                    }}
                    disabled={modSyncChoiceBusy}
                  >
                    Sync using modpack metadata
                  </PrimaryButton>
                  <SubtleButton
                    onClick={async () => {
                      setModSyncChoiceOpen(false);
                      if (pendingLaunchAfterSync && selectedServer) {
                        setPendingLaunchAfterSync(false);
                        await performLaunchForServer(selectedServer);
                      } else {
                        setPendingLaunchAfterSync(false);
                      }
                      if (modSyncChoiceRemember) {
                        await saveAppSettings({ ...effectiveAppSettings, mod_sync_mode: "ask" });
                      }
                    }}
                    disabled={modSyncChoiceBusy}
                  >
                    Skip for now
                  </SubtleButton>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-text">Remember my choice</p>
                    <p className="text-xs text-muted">You can change this later in settings.</p>
                  </div>
                  <Switch.Root
                    checked={modSyncChoiceRemember}
                    onCheckedChange={setModSyncChoiceRemember}
                    className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
                    disabled={modSyncChoiceBusy}
                  >
                    <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
                  </Switch.Root>
                </div>
              </div>
            </div>
          )}
          {compatHelpOpen && (
            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-6">
              <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-surface p-6 text-sm text-text shadow-soft">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Compatibility</p>
                    <h3 className="mt-2 font-display text-xl text-text">How to fix</h3>
                  </div>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
                    onClick={() => setCompatHelpOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="mt-4 grid gap-2 text-xs text-muted">
                  <p>Make sure your Minecraft version matches the server version.</p>
                  <p>Use the same modloader as the server (Forge/Fabric).</p>
                  <p>Sync missing mods before joining.</p>
                </div>
              </div>
            </div>
          )}
          {updateModalOpen && (
            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-6">
              <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface p-6 text-sm text-text shadow-soft">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted">Update available</p>
                    <h3 className="mt-2 font-display text-xl text-text">A newer version is ready</h3>
                  </div>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
                    onClick={() => setUpdateModalOpen(false)}
                  >
                    Later
                  </button>
                </div>
                <div className="mt-4 grid gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">Latest version</p>
                  <p className="text-sm text-text">{updateInfo?.latest_version ?? "Unknown"}</p>
                </div>
                {updateError && <p className="mt-3 text-xs text-danger">{updateError}</p>}
                <div className="mt-5 flex items-center justify-end gap-3">
                  <SubtleButton onClick={() => setUpdateModalOpen(false)}>Later</SubtleButton>
                  <PrimaryButton onClick={handleUpdateNow} disabled={updateDownloading || !updateInfo?.download_url}>
                    {updateDownloading ? "Downloading..." : "Download update"}
                  </PrimaryButton>
                </div>
                <p className="mt-3 text-xs text-muted">The installer will open after download completes.</p>
              </div>
            </div>
          )}
          <CrashModal
            open={crashModalOpen}
            crashReports={crashReports}
            crashLoading={crashLoading}
            activeCrashReport={activeCrashReport}
            onClose={() => setCrashModalOpen(false)}
            onOpenReport={openCrashReport}
            onClear={clearCrashReports}
            onExport={handleExportCrashReports}
          />
          <AnimatePresence>
            {tutorialActive && activeTutorialStep && (
              <motion.div
                className="fixed bottom-6 right-6 z-60 w-full max-w-sm rounded-2xl border border-white/10 bg-surface p-4 text-sm text-text shadow-soft"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <p className="text-xs uppercase tracking-[0.2em] text-muted">Tutorial</p>
                <h4 className="mt-2 font-display text-lg text-text">{activeTutorialStep.title}</h4>
                <p className="mt-2 text-sm text-muted">{activeTutorialStep.body}</p>
                <div className="mt-4 flex items-center justify-between">
                  <SubtleButton onClick={prevTutorial} disabled={tutorialStepIndex === 0}>
                    Previous
                  </SubtleButton>
                  <div className="flex items-center gap-2">
                    <SubtleButton onClick={() => stopTutorial()}>Dismiss</SubtleButton>
                    <PrimaryButton onClick={nextTutorial}>
                      {tutorialStepIndex >= TUTORIAL_STEPS.length - 1 ? "Done" : "Next"}
                    </PrimaryButton>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence mode="wait">
            {view === "loading" && (
              <motion.div
              key="loading"
              className="mx-auto flex h-full max-w-5xl flex-col items-center justify-start gap-10 overflow-hidden pt-20 text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
            >
              <div className="h-52 w-52">
                <img src="/logo.png" alt="Gamehost ONE" className="h-full w-full rounded-2xl" />
              </div>
              <BrandName className="text-3xl font-semibold text-text" />
              <div className="w-full max-w-4xl">
                <div ref={loadingAnimRef} className="h-96 w-full" />
              </div>
              </motion.div>
            )}

            {view === "welcome" && (
              <motion.div
              key="welcome"
              className="mx-auto flex min-h-[80vh] max-w-5xl flex-col items-center justify-center gap-4 text-center"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
            >
              <BrandName className="text-sm uppercase tracking-[0.3em] text-muted" />
              <h1 className="font-display text-4xl text-text">Welcome, gamer! 👋</h1>
              <p className="text-sm text-muted">Ready to spin up your next world?</p>
              </motion.div>
            )}

            {view === "library" && (
              <motion.div
              key="library"
              variants={container}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0 }}
              className="mx-auto flex w-full max-w-6xl flex-col gap-8"
            >
              <motion.header variants={item} className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-24 w-24 rounded-3xl">
                    <img src="/logo.png" alt="Gamehost ONE" className="h-full w-full rounded-2xl" />
                  </div>
                  <div>
                    <BrandName className="text-xs uppercase tracking-[0.3em] text-muted" />
                    <h1 className="font-display text-3xl text-text">Your server. Zero hassle.</h1>
                  </div>
                </div>
              </motion.header>

              <motion.div variants={item} className="grid gap-6 lg:grid-cols-2">
                <button
                  className="group flex cursor-pointer flex-col gap-4 overflow-hidden rounded-3xl border border-white/10 bg-white/5 text-left transition hover:border-one/40 hover:bg-white/10"
                  onClick={() => {
                    changeView("servers");
                    if (tutorialActive && activeTutorialStep?.id === "open-minecraft") {
                      nextTutorial();
                    }
                  }}
                  data-tutorial="open-minecraft"
                >
                  <div className="relative h-48 w-full">
                    <img
                      src="/minecraft.webp"
                      alt="Minecraft"
                      className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
                    />
                    <div className="absolute inset-0 bg-linear-to-t from-background/90 via-background/30 to-transparent" />
                  </div>
                  <div className="flex flex-1 flex-col gap-3 px-6 pb-6">
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-xl text-text">Minecraft</h2>
                    </div>
                    <p className="text-sm text-muted">Manage your Java edition server builds and mods.</p>
                    <div className="mt-auto flex items-center justify-center">
                      <span className="text-xs text-muted/80">Click to open</span>
                    </div>
                  </div>
                </button>
                <div className="flex flex-col gap-4 rounded-3xl border border-dashed border-white/10 bg-white/5 p-6 text-left">
                  <h2 className="font-display text-xl text-text">More games</h2>
                  <p className="text-sm text-muted">More games coming soon...</p>
                </div>
              </motion.div>
              </motion.div>
            )}

            {view === "settings" && (
              <motion.div
              key="settings"
              variants={container}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0 }}
              className="mx-auto flex w-full max-w-6xl flex-col gap-8"
            >
              <motion.header variants={item} className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-3xl border border-white/10 bg-white/5">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 text-one" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.03.03a2 2 0 1 1-2.83 2.83l-.03-.03a1.7 1.7 0 0 0-1.82-.33 1.7 1.7 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.06a1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.82.33l-.03.03a2 2 0 1 1-2.83-2.83l.03-.03a1.7 1.7 0 0 0 .33-1.82 1.7 1.7 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.06a1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.33-1.82l-.03-.03a2 2 0 1 1 2.83-2.83l.03.03a1.7 1.7 0 0 0 1.82.33 1.7 1.7 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.06a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.82-.33l.03-.03a2 2 0 1 1 2.83 2.83l-.03.03a1.7 1.7 0 0 0-.33 1.82 1.7 1.7 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.06a1.7 1.7 0 0 0-1.51 1z" />
                    </svg>
                  </div>
                  <div>
                    <BrandName className="text-xs uppercase tracking-[0.3em] text-muted" />
                    <h1 className="font-display text-3xl text-text">App Settings</h1>
                  </div>
                </div>
                {appVersion && (
                  <span className="text-xs uppercase tracking-[0.2em] text-muted">v{appVersion}</span>
                )}
              </motion.header>

              <motion.div variants={item} className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
                <div className="grid gap-6">
                  <Card title="Updates">
                    <div className="grid gap-4">
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-muted">Status</p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                          <span className="text-sm text-text">
                            {updateInfo?.update_available
                              ? `Update available${updateInfo.latest_version ? ` (v${updateInfo.latest_version})` : ""}`
                              : "You are up to date"}
                          </span>
                          <span
                            className={classNames(
                              "rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
                              updateInfo?.update_available ? "bg-amber-500/20 text-amber-200" : "bg-secondary/20 text-secondary"
                            )}
                          >
                            {updateInfo?.update_available ? "Update" : "Ready"}
                          </span>
                        </div>
                        {updateError && <p className="mt-2 text-xs text-danger">{updateError}</p>}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <PrimaryButton onClick={() => handleCheckUpdates(false)} disabled={updateChecking}>
                          {updateChecking ? "Checking..." : "Check for updates"}
                        </PrimaryButton>
                        <SubtleButton
                          onClick={handleUpdateNow}
                          disabled={!updateInfo?.update_available || updateDownloading || !updateInfo?.download_url}
                        >
                          {updateDownloading ? "Downloading..." : "Update now"}
                        </SubtleButton>
                      </div>
                      <p className="text-xs text-muted">Updates are installed manually and never run silently.</p>
                    </div>
                  </Card>

                  <Card title="Privacy & Data">
                    <div className="grid gap-4">
                      <SettingRow
                        label="Anonymous analytics"
                        description="Help us improve GameHost ONE with local event counts. Off by default."
                      >
                        <span
                          className={classNames(
                            "rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
                            effectiveAppSettings.analytics_enabled ? "bg-secondary/20 text-secondary" : "bg-white/10 text-muted"
                          )}
                        >
                          {effectiveAppSettings.analytics_enabled ? "On" : "Off"}
                        </span>
                        <Switch.Root
                          checked={effectiveAppSettings.analytics_enabled}
                          onCheckedChange={(value) =>
                            saveAppSettings({ ...effectiveAppSettings, analytics_enabled: value })
                          }
                          className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
                          disabled={appSettingsSaving}
                        >
                          <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
                        </Switch.Root>
                      </SettingRow>
                      <SettingRow
                        label="Crash reports"
                        description="Store local crash reports so you can share them if needed."
                      >
                        <span
                          className={classNames(
                            "rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
                            effectiveAppSettings.crash_reporting_enabled ? "bg-secondary/20 text-secondary" : "bg-white/10 text-muted"
                          )}
                        >
                          {effectiveAppSettings.crash_reporting_enabled ? "On" : "Off"}
                        </span>
                        <Switch.Root
                          checked={effectiveAppSettings.crash_reporting_enabled}
                          onCheckedChange={(value) =>
                            saveAppSettings({ ...effectiveAppSettings, crash_reporting_enabled: value })
                          }
                          className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
                          disabled={appSettingsSaving}
                        >
                          <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
                        </Switch.Root>
                      </SettingRow>
                    </div>
                  </Card>

                  <Card title="Interface">
                    <div className="grid gap-4">
                      <SettingRow
                        label="Smart Join Panel"
                        description="Show a floating join card when your server is running."
                      >
                        <span
                          className={classNames(
                            "rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
                            effectiveAppSettings.smart_join_panel_enabled
                              ? "bg-secondary/20 text-secondary"
                              : "bg-white/10 text-muted"
                          )}
                        >
                          {effectiveAppSettings.smart_join_panel_enabled ? "On" : "Off"}
                        </span>
                        <Switch.Root
                          checked={Boolean(effectiveAppSettings.smart_join_panel_enabled)}
                          onCheckedChange={(value) =>
                            saveAppSettings({ ...effectiveAppSettings, smart_join_panel_enabled: value })
                          }
                          className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
                          disabled={appSettingsSaving}
                        >
                          <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
                        </Switch.Root>
                      </SettingRow>
                      <SettingRow
                        label="Windows start notification"
                        description="Show a native Windows notification when the server starts."
                      >
                        <span
                          className={classNames(
                            "rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
                            effectiveAppSettings.notify_on_server_start
                              ? "bg-secondary/20 text-secondary"
                              : "bg-white/10 text-muted"
                          )}
                        >
                          {effectiveAppSettings.notify_on_server_start ? "On" : "Off"}
                        </span>
                        <Switch.Root
                          checked={Boolean(effectiveAppSettings.notify_on_server_start)}
                          onCheckedChange={(value) =>
                            saveAppSettings({ ...effectiveAppSettings, notify_on_server_start: value })
                          }
                          className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
                          disabled={appSettingsSaving}
                        >
                          <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
                        </Switch.Root>
                      </SettingRow>
                      <SettingRow
                        label="Mod sync on launch"
                        description="Choose how to sync server mods when launching Minecraft."
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {([
                            { value: "ask", label: "Ask" },
                            { value: "metadata", label: "Metadata" }
                          ] as const).map((option) => (
                            <SubtleButton
                              key={option.value}
                              className={classNames(
                                effectiveAppSettings.mod_sync_mode === option.value
                                  ? "bg-one/20 text-one ring-1 ring-one/40"
                                  : ""
                              )}
                              onClick={() =>
                                saveAppSettings({ ...effectiveAppSettings, mod_sync_mode: option.value })
                              }
                              disabled={appSettingsSaving}
                            >
                              {option.label}
                            </SubtleButton>
                          ))}
                        </div>
                      </SettingRow>
                    </div>
                  </Card>

                </div>

                <div className="grid gap-6">
                  <Card title="About">
                    <div className="grid gap-2">
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2">
                        <p className="text-xs uppercase tracking-[0.2em] text-muted">App data</p>
                        <p className="mt-1 text-xs text-text break-all">{appDataDisplay}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <SubtleButton onClick={openAppData}>Open folder</SubtleButton>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2">
                        <p className="text-xs uppercase tracking-[0.2em] text-muted">Privacy</p>
                        <p className="mt-1 text-xs text-muted">Read how we handle data and crashes.</p>
                        <div className="mt-2 flex items-center gap-2">
                          <SubtleButton onClick={() => openUrl(`https://github.com/${UPDATE_REPO}/blob/main/docs/privacy-policy.md`)}>
                            View privacy policy
                          </SubtleButton>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2">
                        <p className="text-xs uppercase tracking-[0.2em] text-muted">Web</p>
                        <div className="mt-2 flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2">
                            <img src="/logo.png" alt="Gamehost ONE" className="h-5 w-5 rounded-md" />
                            <p className="text-sm font-semibold text-text">
                              Gamehost <span className="text-teal-300">ONE</span>
                            </p>
                          </div>
                          <SubtleButton onClick={() => openUrl("https://gamehost-one-web.pages.dev/")}
                          >
                            <span className="flex items-center gap-2">
                              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M2 12h20" />
                                <path d="M12 2a15 15 0 0 1 0 20" />
                                <path d="M12 2a15 15 0 0 0 0 20" />
                              </svg>
                              <span>Open</span>
                            </span>
                          </SubtleButton>
                        </div>
                      </div>
                    </div>
                  </Card>
                  <Card title="Crash Reports">
                    <div className="grid gap-4">
                      {crashReports.length === 0 ? (
                        <p className="text-sm text-muted">No crash reports recorded.</p>
                      ) : (
                        <div className="grid gap-2">
                          {crashReports.slice(0, 3).map((report) => (
                            <div
                              key={report.file_name}
                              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                            >
                              <div>
                                <p className="text-sm text-text">{new Date(report.timestamp).toLocaleString()}</p>
                                <p className="text-xs text-muted">{report.message}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <SubtleButton onClick={() => openCrashReport(report.file_name)}>
                                  View
                                </SubtleButton>
                                <SubtleButton
                                  onClick={() => deleteCrashReport(report.file_name)}
                                  className="text-danger"
                                >
                                  Delete
                                </SubtleButton>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {crashReports.length > 3 && (
                        <div className="flex items-center justify-end">
                          <SubtleButton onClick={() => setCrashModalOpen(true)}>
                            More reports
                          </SubtleButton>
                        </div>
                      )}
                      {crashReports.length > 0 && (
                        <div className="flex items-center justify-end">
                          <div className="flex items-center gap-2">
                            <SubtleButton onClick={handleExportCrashReports}>Export reports</SubtleButton>
                            <SubtleButton onClick={clearCrashReports} className="text-danger">
                              Clear all
                            </SubtleButton>
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              </motion.div>
              </motion.div>
            )}

            {view === "servers" && (
              <motion.div
              key="servers"
              variants={container}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0 }}
              className="relative mx-auto flex w-full max-w-6xl flex-col gap-8"
            >
              <div className="pointer-events-none absolute inset-0 z-0 opacity-25 blur-2xl">
                <img src="/minecraft.webp" alt="" className="h-full w-full object-cover" />
              </div>
              <div className="relative z-10 flex flex-col gap-8">
                <motion.header variants={item} className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <button
                      className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-text transition hover:bg-white/20"
                      onClick={() => changeView("library")}
                    >
                      Back
                    </button>
                    <div className="flex items-center gap-3">
                      <img src="/MC-logo.webp" alt="Minecraft" className="h-12 w-12 object-contain" />
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-muted">Minecraft</p>
                        <h1 className="font-display text-3xl text-text">Server Library</h1>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <CreateServerMenu
                      label="Create Server"
                      onCreate={handleOpenWizard}
                      onImport={() => setImportOpen(true)}
                      onMigrate={() => changeView("migration")}
                      dataTutorial="create-server"
                    />
                  </div>
                </motion.header>

                <motion.div variants={item} className="grid gap-4">
                  {servers.length === 0 ? (
                    <Card>
                      <div className="flex flex-col gap-4">
                        <h2 className="font-display text-xl text-text">No servers yet</h2>
                        <p className="text-sm text-muted">Create your first Minecraft server in minutes.</p>
                        <CreateServerMenu
                          label="Create your first server"
                          onCreate={handleOpenWizard}
                          onImport={() => setImportOpen(true)}
                          onMigrate={() => changeView("migration")}
                        />
                      </div>
                    </Card>
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                      {servers.map((server) => {
                        const cardStatus = serverStatusFor(server);
                        const cardActions = getActionState(cardStatus);

                        return (
                          <div
                            key={server.name}
                            role="button"
                            tabIndex={0}
                            className="group cursor-pointer overflow-hidden rounded-3xl border border-white/10 bg-white/5 text-left transition hover:border-one/40 hover:bg-white/10"
                            onClick={() => handleOpenServer(server)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleOpenServer(server);
                              }
                            }}
                          >
                          <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-white/5 px-6 py-4">
                            <div className="flex items-center gap-4">
                              <img
                                src={serverIcons[server.name] ?? "/logo.png"}
                                alt={server.name}
                                className="h-12 w-12 rounded-xl object-cover"
                              />
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-muted">{getServerTypeLabel(server.server_type)}</p>
                                <h3 className="font-display text-xl text-text">{server.name}</h3>
                              </div>
                            </div>
                            <div className="flex min-w-50 items-center justify-end gap-3">
                              {cardActions.showStarting ? (
                                <span className="flex items-center gap-2 text-[11px] text-primary">
                                  <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                                  {cardActions.statusLabel}
                                </span>
                              ) : (
                                <StatusPill status={cardStatus} />
                              )}
                            </div>
                          </div>
                          <div className="px-6 py-4">
                            <p className="text-xs text-muted">
                              Version {server.version} · RAM {server.ram_gb} GB
                              {server.linked ? " · Linked" : ""}
                            </p>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <SubtleButton
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleServerAction("start", server);
                                }}
                                disabled={!cardActions.canStart}
                                className="bg-one/20 text-one hover:bg-one/30"
                              >
                                Start
                              </SubtleButton>
                              <SubtleButton
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleServerAction("stop", server);
                                }}
                                disabled={!cardActions.canStop}
                                className="bg-danger/20 text-danger hover:bg-danger/30"
                              >
                                Stop
                              </SubtleButton>
                              <SubtleButton
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleServerAction("restart", server);
                                }}
                                disabled={!cardActions.canRestart}
                                className="bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                              >
                                Restart
                              </SubtleButton>
                              <button
                                className="ml-auto flex items-center gap-2 rounded-full border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] font-semibold text-danger transition hover:bg-danger/20"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDeleteTarget(server);
                                  setDeleteConfirm("");
                                }}
                                aria-label="Delete server"
                              >
                                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 6h18" />
                                  <path d="M8 6v-2h8v2" />
                                  <path d="M6 6l1 14h10l1-14" />
                                </svg>
                                Delete
                              </button>
                            </div>
                          </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>

                <motion.div
                  variants={item}
                  className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex items-center justify-center px-4 text-xs text-muted"
                >
                  <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-full border border-white/10 bg-surface/80 px-4 py-2 shadow-soft">
                    <span>Server data is stored in</span>
                    <button className="text-one hover:text-one/80" onClick={openAppData}>
                      {appDataDisplay}
                    </button>
                  </div>
                </motion.div>
              </div>
              </motion.div>
            )}

            {view === "migration" && (
              <motion.div
              key="migration"
              variants={container}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0 }}
              className="mx-auto flex w-full max-w-5xl flex-col gap-8"
            >
              <motion.header variants={item} className="flex flex-wrap items-center gap-4">
                <button
                  className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-text transition hover:bg-white/20"
                  onClick={() => changeView("servers")}
                >
                  Back
                </button>
                <div className="flex items-center gap-3">
                  <img src="/MC-logo.webp" alt="Minecraft" className="h-12 w-12 object-contain" />
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">Minecraft</p>
                    <h1 className="font-display text-3xl text-text">Migration Wizard</h1>
                  </div>
                </div>
              </motion.header>

              <motion.div variants={item}>
                <MigrationWizard
                  systemRamGb={systemRamGb}
                  safeRamMaxGb={safeRamMaxGb}
                  recommendedRamGb={recommendedRamGb}
                  onBack={() => changeView("servers")}
                  onCreate={handleMigrationCreate}
                />
              </motion.div>
              </motion.div>
            )}

            {view === "wizard" && (
              <motion.div
              key="wizard"
              variants={container}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0 }}
              className="mx-auto flex w-full max-w-5xl flex-col gap-8"
            >
              <motion.header variants={item} className="flex flex-wrap items-center gap-4">
                <button
                  className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-text transition hover:bg-white/20"
                  onClick={() => changeView("servers")}
                >
                  Back
                </button>
                <div className="flex items-center gap-3">
                  <img src="/MC-logo.webp" alt="Minecraft" className="h-12 w-12 object-contain" />
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">Minecraft</p>
                    <h1 className="font-display text-3xl text-text">Server Wizard</h1>
                  </div>
                </div>
              </motion.header>

              <motion.div variants={item}>
                <Card>
                  <div className="grid gap-4">
                    <div className="grid gap-2" data-tutorial="ram-allocation">
                      <label className="text-xs uppercase tracking-[0.2em] text-muted">Server Name</label>
                      <input
                        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
                        value={wizardName}
                        onChange={(event) => setWizardName(event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-xs uppercase tracking-[0.2em] text-muted">Server Type</label>
                      <Select.Root
                        value={wizardType}
                        onValueChange={(value) => setWizardType(value as ServerConfig["server_type"])}
                      >
                        <Select.Trigger className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none">
                          <Select.Value />
                          <Select.Icon className="text-muted">▾</Select.Icon>
                        </Select.Trigger>
                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            side="bottom"
                            align="start"
                            sideOffset={8}
                            avoidCollisions={false}
                            className="select-content z-50 overflow-hidden rounded-2xl border border-white/10 shadow-soft"
                          >
                            <Select.Viewport className="bg-surface p-1">
                              {SERVER_TYPES.map((type) => (
                                <Select.Item
                                  key={type.value}
                                  value={type.value}
                                  className="cursor-pointer rounded-xl px-3 py-2 text-sm text-text outline-none data-highlighted:bg-white/15 data-highlighted:text-white"
                                >
                                  <Select.ItemText>{type.label}</Select.ItemText>
                                </Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </div>
                    <div className="grid gap-2">
                      <label className="text-xs uppercase tracking-[0.2em] text-muted">Version</label>
                      <Select.Root value={wizardVersion} onValueChange={setWizardVersion}>
                        <Select.Trigger className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none">
                          <Select.Value />
                          <Select.Icon className="text-muted">▾</Select.Icon>
                        </Select.Trigger>
                          <Select.Portal>
                            <Select.Content
                              position="popper"
                              side="bottom"
                              align="start"
                              sideOffset={8}
                              avoidCollisions={false}
                              className="select-content z-50 overflow-hidden rounded-2xl border border-white/10 shadow-soft"
                            >
                            <div className="border-b border-white/10 bg-surface/95 p-2">
                              <input
                                className="w-full rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs text-text focus:border-one/60 focus:outline-none"
                                placeholder={wizardForgeLoading ? "Loading Forge versions..." : "Search versions"}
                                value={wizardVersionFilter}
                                onChange={(event) => setWizardVersionFilter(event.target.value)}
                                disabled={wizardForgeLoading}
                              />
                            </div>
                            {wizardVersionLimitHit && (
                              <div className="border-b border-white/10 bg-surface/95 px-3 py-2 text-[10px] text-muted">
                                Showing first {wizardVersionLimit} versions. Type to search more.
                              </div>
                            )}
                            <Select.Viewport className="bg-surface p-1">
                              {wizardFilteredVersionGroups.map((group) => (
                                <Select.Group key={group.label}>
                                  <Select.Label className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                                    {group.label}
                                  </Select.Label>
                                  {group.versions.map((version) => (
                                    <Select.Item
                                      key={version.value}
                                      value={version.value}
                                      className="cursor-pointer rounded-xl px-3 py-2 text-sm text-text outline-none data-highlighted:bg-white/15 data-highlighted:text-white"
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <Select.ItemText>{version.label ?? version.value}</Select.ItemText>
                                        {version.recommended && (
                                          <span className="rounded-full bg-one/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-one">
                                            Recommended
                                          </span>
                                        )}
                                      </div>
                                    </Select.Item>
                                  ))}
                                </Select.Group>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </div>
                    <WorldStep
                      mode={wizardWorldMode}
                      sourcePath={wizardWorldSource}
                      validation={wizardWorldValidation}
                      error={wizardWorldError}
                      busy={wizardWorldBusy}
                      copyProgress={wizardWorldCopy}
                      copyDone={wizardWorldCopied}
                      onModeChange={handleWorldModeChange}
                      onPickFolder={() => handlePickWorld("folder")}
                      onPickZip={() => handlePickWorld("zip")}
                      onClear={handleClearWorld}
                    />
                    {wizardType === "forge" && (
                      <ModsStep
                        mode={wizardModsMode}
                        sourcePath={wizardModsSource}
                        validation={wizardModsValidation}
                        error={wizardModsError}
                        busy={wizardModsBusy}
                        onModeChange={handleModsModeChange}
                        onPickFolder={() => handlePickMods("folder")}
                        onPickZip={() => handlePickMods("zip")}
                        onClear={handleClearMods}
                      />
                    )}
                    <div className="grid gap-2">
                      <label className="text-xs uppercase tracking-[0.2em] text-muted">Gameplay</label>
                      <ServerSettingsFields
                        settings={wizardSettings}
                        onChange={updateWizardSettings}
                        variant="basic"
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-xs uppercase tracking-[0.2em] text-muted">RAM Allocation</label>
                      <p className="text-xs text-muted">Controls how much memory the server can use.</p>
                      {systemRamGb && (
                        <p className="text-xs text-muted">
                          You have {systemRamGb} GB RAM — we recommend{" "}
                          <span className="font-semibold text-one">
                            {wizardRecommendedRamGb ?? recommendedRamGb ?? systemRamGb} GB
                          </span>
                          .
                        </p>
                      )}
                      {wizardRam === wizardRecommendedRamGb && wizardRecommendedRamGb && (
                        <p className="text-xs text-muted">Recommended RAM selected.</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {wizardRamOptions.map((ram) => (
                          <button
                            key={ram}
                            className={classNames(
                              "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition",
                              wizardRam === ram
                                ? "bg-one text-white"
                                : "bg-white/10 text-text hover:bg-white/20",
                              ram === wizardRecommendedRamGb && wizardRam !== ram ? "ring-1 ring-one/40" : ""
                            )}
                            onClick={() => {
                              setWizardRam(ram);
                              setRamManualInput(String(ram));
                              setWizardRamAuto(false);
                            }}
                            type="button"
                          >
                            <span>{ram} GB</span>
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <SubtleButton onClick={() => setRamManualOpen((prev) => !prev)}>
                          {ramManualOpen ? "Hide manual input" : "Choose RAM allocation manually"}
                        </SubtleButton>
                        {wizardRecommendedRamGb && !wizardRamAuto && (
                          <SubtleButton
                            className="bg-one/20 text-one ring-1 ring-one/40 hover:bg-one/25"
                            onClick={() => {
                              setWizardRamAuto(true);
                              setWizardRam(wizardRecommendedRamGb);
                              setRamManualInput(String(wizardRecommendedRamGb));
                            }}
                          >
                            Use recommended
                          </SubtleButton>
                        )}
                        <span className="text-xs text-muted">Min 1 GB · Max {safeRamMaxGb} GB</span>
                      </div>
                      {ramManualOpen && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={safeRamMaxGb}
                            value={ramManualInput}
                            onChange={(event) => {
                              const raw = Number(event.target.value);
                              const next = Math.max(1, Math.min(safeRamMaxGb, Number.isFinite(raw) ? raw : 1));
                              setRamManualInput(event.target.value);
                              setWizardRam(next);
                              setWizardRamAuto(false);
                            }}
                            className="w-24 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-text focus:border-one/60 focus:outline-none"
                          />
                          <span className="text-xs text-muted">GB</span>
                        </div>
                      )}
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
                            wizardOnlineMode ? "bg-secondary/20 text-secondary" : "bg-white/10 text-muted"
                          )}
                        >
                          {wizardOnlineMode ? "On" : "Off"}
                        </span>
                        <Switch.Root
                          checked={wizardOnlineMode}
                          onCheckedChange={setWizardOnlineMode}
                          className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
                        >
                          <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
                        </Switch.Root>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <PrimaryButton
                        onClick={handleCreateServer}
                        disabled={
                          installing ||
                          !wizardWorldReady ||
                          !wizardModsReady ||
                          wizardWorldBusy ||
                          wizardModsBusy
                        }
                      >
                        {installing ? "Installing..." : "Create Server"}
                      </PrimaryButton>
                      <SubtleButton onClick={() => setWizardAdvancedOpen(true)}>Advanced settings</SubtleButton>
                      <p className="text-xs text-muted">Server data stays in AppData.</p>
                    </div>
                    {error && <p className="text-xs text-danger">{error}</p>}
                  </div>
                </Card>
              </motion.div>
              {wizardAdvancedOpen && (
                <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50">
                  <div className="flex h-full w-full max-w-md flex-col gap-6 bg-surface p-6 shadow-soft">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-muted">Advanced</p>
                        <h2 className="font-display text-xl text-text">Advanced settings</h2>
                      </div>
                      <button
                        className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
                        onClick={() => setWizardAdvancedOpen(false)}
                      >
                        Close
                      </button>
                    </div>
                    <ServerSettingsFields
                      settings={wizardSettings}
                      onChange={updateWizardSettings}
                      variant="advanced"
                    />
                    <div className="mt-auto flex items-center justify-between">
                      <p className="text-xs text-muted">Changes apply to this server only.</p>
                      <PrimaryButton onClick={() => setWizardAdvancedOpen(false)}>Done</PrimaryButton>
                    </div>
                  </div>
                </div>
              )}
              </motion.div>
            )}

            {view === "detail" && selectedServer && (
              <motion.div
              key="detail"
              variants={container}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0 }}
              className="mx-auto flex w-full max-w-6xl flex-col gap-8"
            >
              <motion.header variants={item} className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <button
                    className="rounded-full bg-white/10 px-3 py-2 text-xs font-semibold text-text transition hover:bg-white/20"
                    onClick={() => changeView("servers")}
                  >
                    Back
                  </button>
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-muted">Minecraft</p>
                    <h1 className="font-display text-3xl text-text">{selectedServer.name}</h1>
                    <p className="text-xs text-muted">
                      {formatLoaderLabel(serverMetadata?.loader ?? getServerTypeLabel(selectedServer.server_type))}{" "}
                      {serverMetadata?.mcVersion && serverMetadata.mcVersion !== "unknown"
                        ? serverMetadata.mcVersion
                        : selectedServer.version}
                      {" · RAM "}{selectedServer.ram_gb} GB
                      {serverMetadata?.modCount ? ` · ${serverMetadata.modCount} Mods Detected` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {actionState.showStarting ? (
                    <span className="flex items-center gap-2 text-xs text-primary">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                      {actionState.statusLabel}
                    </span>
                  ) : (
                    <StatusPill status={serverStatusFor(selectedServer)} />
                  )}
                  <div className="rounded-full border border-white/10 bg-white/5 p-1 transition hover:border-primary/40 hover:bg-white/10">
                    <PrimaryButton
                      onClick={() => handleServerAction("start")}
                      disabled={!actionState.canStart}
                      data-tutorial="start-server"
                    >
                      Start
                    </PrimaryButton>
                  </div>
                  <SubtleButton
                    onClick={() => handleServerAction("stop")}
                    disabled={!actionState.canStop}
                    className="bg-danger/20 text-danger hover:bg-danger/30"
                  >
                    Stop
                  </SubtleButton>
                  <SubtleButton
                    onClick={() => handleServerAction("restart")}
                    disabled={!actionState.canRestart}
                    className="bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                  >
                    Restart
                  </SubtleButton>
                </div>
              </motion.header>

              {serverStatusFor(selectedServer) === "STARTING" && (
                <motion.div
                  variants={item}
                  className="fixed right-6 top-28 z-40 w-full max-w-xs rounded-3xl border border-white/10 bg-surface/95 p-4 text-sm text-text shadow-soft"
                >
                  <div className="flex items-center gap-3">
                    <img src="/MC-logo.webp" alt="Minecraft" className="h-10 w-10 object-contain" />
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-muted">Minecraft</p>
                      <p className="text-sm font-semibold text-text">Your server is starting…</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    You can already launch Minecraft and join once it’s ready.
                  </p>
                  <div className="mt-4">
                    <div className="flex items-center gap-2">
                      <PrimaryButton onClick={handleLaunchMinecraft}>
                        ▶ Launch Minecraft
                      </PrimaryButton>
                      <SubtleButton onClick={() => setLauncherChoiceOpen(true)}>
                        Change launcher
                      </SubtleButton>
                      {forgeInstallersVisible && (
                        <SubtleButton onClick={handleOpenForgeDownload}>
                          Forge installers
                        </SubtleButton>
                      )}
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] text-muted">
                    Please select version: {selectedServer.version} ({getServerTypeLabel(selectedServer.server_type)})
                  </p>
                </motion.div>
              )}

              <motion.div variants={item}>
                <Tabs.Root value={detailTab} onValueChange={changeDetailTab} className="grid gap-6">
                  <Tabs.List className="relative flex flex-wrap items-center gap-2 rounded-3xl bg-surface px-5 py-4 shadow-soft ring-1 ring-white/5">
                    {[
                      {
                        value: "overview",
                        label: "Overview",
                        icon: (
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 4h7v7H4z" />
                            <path d="M13 4h7v7h-7z" />
                            <path d="M4 13h7v7H4z" />
                            <path d="M13 13h7v7h-7z" />
                          </svg>
                        )
                      },
                      {
                        value: "console",
                        label: "Console",
                        icon: (
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 6h16" />
                            <path d="M4 12h10" />
                            <path d="M4 18h16" />
                          </svg>
                        )
                      },
                      {
                        value: "settings",
                        label: "Settings",
                        icon: (
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.03.03a2 2 0 1 1-2.83 2.83l-.03-.03a1.7 1.7 0 0 0-1.82-.33 1.7 1.7 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.06a1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.82.33l-.03.03a2 2 0 1 1-2.83-2.83l.03-.03a1.7 1.7 0 0 0 .33-1.82 1.7 1.7 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.06a1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.33-1.82l-.03-.03a2 2 0 1 1 2.83-2.83l.03.03a1.7 1.7 0 0 0 1.82.33 1.7 1.7 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.06a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.82-.33l.03-.03a2 2 0 1 1 2.83 2.83l-.03.03a1.7 1.7 0 0 0-.33 1.82 1.7 1.7 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.06a1.7 1.7 0 0 0-1.51 1z" />
                          </svg>
                        )
                      },
                      {
                        value: "advanced",
                        label: "Advanced",
                        icon: (
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2v4" />
                            <path d="M12 18v4" />
                            <path d="M4.9 4.9l2.8 2.8" />
                            <path d="M16.3 16.3l2.8 2.8" />
                            <path d="M2 12h4" />
                            <path d="M18 12h4" />
                            <path d="M4.9 19.1l2.8-2.8" />
                            <path d="M16.3 7.7l2.8-2.8" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )
                      }
                    ].map((tab) => (
                      <Tabs.Trigger
                        key={tab.value}
                        value={tab.value}
                        data-tutorial={tab.value === "console" ? "console-tab" : undefined}
                        className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-muted transition-colors duration-200 data-[state=active]:bg-one/20 data-[state=active]:text-one data-[state=active]:ring-1 data-[state=active]:ring-one/40"
                      >
                        {tab.icon}
                        <span className="hidden sm:inline">{tab.label}</span>
                      </Tabs.Trigger>
                    ))}
                    <div className="ml-auto flex items-center">
                      <button
                        className={classNames(
                          "flex items-center gap-2 rounded-full bg-one px-4 py-2 text-xs font-semibold text-white shadow-soft transition hover:bg-one/90",
                          motdSaving && "cursor-not-allowed opacity-70"
                        )}
                        onClick={() => saveMotd()}
                        disabled={motdSaving}
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                          <path d="M17 21v-8H7v8" />
                          <path d="M7 3v5h8" />
                        </svg>
                        {motdSaving ? "Saving" : "Save"}
                      </button>
                    </div>
                  </Tabs.List>

                  <AnimatePresence mode="wait" initial={false}>
                    {detailTab === "overview" && (
                      <motion.div
                        key="overview"
                        layout
                        className="grid gap-6 lg:grid-cols-[1.2fr_1fr]"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.2 }}
                      >
                    <div className="lg:col-span-2">
                      <Card
                        title="Server Setup"
                        action={
                          <button
                            className="group relative flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-muted transition hover:bg-white/10 hover:text-text"
                            onClick={() => changeDetailTab("settings")}
                            type="button"
                            aria-label="Server settings"
                          >
                            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-one" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="3" />
                              <path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.03.03a2 2 0 1 1-2.83 2.83l-.03-.03a1.7 1.7 0 0 0-1.82-.33 1.7 1.7 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.06a1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.82.33l-.03.03a2 2 0 1 1-2.83-2.83l.03-.03a1.7 1.7 0 0 0 .33-1.82 1.7 1.7 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.06a1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.33-1.82l-.03-.03a2 2 0 1 1 2.83-2.83l.03.03a1.7 1.7 0 0 0 1.82.33 1.7 1.7 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.06a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.82-.33l.03-.03a2 2 0 1 1 2.83 2.83l-.03.03a1.7 1.7 0 0 0-.33 1.82 1.7 1.7 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.06a1.7 1.7 0 0 0-1.51 1z" />
                            </svg>
                            <span className="pointer-events-none absolute right-full mr-2 whitespace-nowrap rounded-full border border-white/10 bg-surface/95 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-muted opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                              Server settings
                            </span>
                          </button>
                        }
                      >
                        <div className="grid gap-6 lg:grid-cols-[0.6fr_1fr]">
                          <div className="grid place-items-center gap-3 text-center">
                            <img
                              src={serverIcons[selectedServer.name] ?? "/logo.png"}
                              alt={selectedServer.name}
                              className="h-16 w-16 rounded-2xl object-cover"
                            />
                            <button
                              className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-text transition hover:bg-white/20"
                              onClick={() => handleIconUpload(selectedServer)}
                              disabled={iconSaving}
                            >
                              {iconSaving ? "Saving..." : "Upload icon"}
                            </button>
                            <p className="text-xs text-muted">Optional: PNG/JPG/WebP, auto-resized to 64x64.</p>
                          </div>
                          <div className="grid gap-3">
                            <div className="grid gap-2">
                              <label className="text-xs uppercase tracking-[0.2em] text-muted">MOTD</label>
                              <input
                                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
                                value={motdDraft}
                                onChange={(event) => setMotdDraft(event.target.value)}
                                placeholder="Gamehost ONE"
                              />
                              <p className="text-xs text-muted">Keep it short so it fits nicely in the server list.</p>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                              <p className="text-xs uppercase tracking-[0.2em] text-muted">Preview</p>
                              <p className="mt-2 text-sm text-text">
                                {motdPreview.map((part, index) =>
                                  part === "ONE" ? (
                                    <span key={`${part}-${index}`} className="text-one">
                                      {String(part)}
                                    </span>
                                  ) : (
                                    <span key={`${part}-${index}`}>{String(part)}</span>
                                  )
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-muted">Save from the top bar to apply changes.</span>
                            </div>
                          </div>
                        </div>
                      </Card>
                    </div>
                    <Card title="Live Resource Monitor">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-full max-w-sm">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-sm text-text">
                              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-one" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 7h16" />
                                <path d="M4 12h16" />
                                <path d="M4 17h16" />
                                <path d="M7 5v14" />
                                <path d="M17 5v14" />
                              </svg>
                              RAM
                              {ramAlertLevel >= 80 && (
                                <span
                                  title={ramWarningText}
                                  className={classNames(
                                    "flex h-5 w-5 items-center justify-center rounded-full",
                                    ramAlertLevel >= 95 ? "bg-danger/20 text-danger" : "bg-amber-500/20 text-amber-200"
                                  )}
                                >
                                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                    <path d="M12 9v4" />
                                    <path d="M12 17h.01" />
                                  </svg>
                                </span>
                              )}
                            </span>
                            <span className="text-sm text-muted">
                              {resource && memoryUsageGb !== null && memoryLimitGb !== null
                                ? `${memoryUsageGb.toFixed(1)} / ${memoryLimitGb.toFixed(1)} GB`
                                : "-"}
                            </span>
                          </div>
                          <div className="mt-2">
                            <SegmentedBar value={memoryPercent} tone={ramTone} pulse={ramAlertLevel >= 95} />
                          </div>
                        </div>
                      </div>
                    </Card>
                    <Card title="Server Overview">
                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted">Status</p>
                          <div className="mt-2 flex items-center gap-3">
                            {overviewAction.showStarting ? (
                              <span className="flex items-center gap-2 text-xs text-primary">
                                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                                {overviewAction.statusLabel}
                              </span>
                            ) : (
                              <StatusPill status={overviewStatus} />
                            )}
                            <span className="ml-auto text-xs text-muted">{getServerTypeLabel(selectedServer.server_type).toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted">Players</p>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-sm text-text">{Math.min(activePlayers, activeSettings.maxPlayers)} online</span>
                            <span className="text-xs text-muted">
                              {Math.min(activePlayers, activeSettings.maxPlayers)}/{activeSettings.maxPlayers}
                            </span>
                          </div>
                        </div>
                      </div>
                    </Card>
                    <Card title="Client & Join">
                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted">Client</p>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            {clientStatus?.running ? (
                              <span className="text-sm text-text">
                                Minecraft detected ({formatLoaderLabel(clientLoader)} {clientVersion ?? "unknown"})
                              </span>
                            ) : clientChecking ? (
                              <span className="text-xs text-muted">Checking for Minecraft...</span>
                            ) : clientStatus?.mcVersion ? (
                              <span className="text-xs text-muted">
                                Last detected ({formatLoaderLabel(clientStatus.loader ?? "vanilla")} {clientStatus.mcVersion})
                              </span>
                            ) : launcherOpenedAt ? (
                              <span className="text-xs text-muted">Launcher opened. Start the game to detect client.</span>
                            ) : (
                              <span className="text-xs text-muted">Minecraft not detected</span>
                            )}
                            {clientStatus?.running && (
                              <span className="rounded-full bg-secondary/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary">
                                Ready
                              </span>
                            )}
                          </div>
                        </div>

                        {clientStatus?.running && versionMismatch && selectedServer && (
                          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                            Your client version does not match the server ({selectedServer.version} required)
                          </div>
                        )}
                        {clientStatus?.running && loaderMismatch && (
                          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                            Server requires {formatLoaderLabel(serverLoader)}, but your client is {formatLoaderLabel(clientLoader)}
                          </div>
                        )}
                        {clientStatus?.running && supportsMods && modMismatch && (
                          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                            <p>Mods do not match this server.</p>
                            <p>Sync required before joining.</p>
                          </div>
                        )}
                        {clientStatus?.running && isCompatible && (
                          <div className="rounded-2xl border border-secondary/30 bg-secondary/10 px-4 py-3 text-xs text-secondary">
                            Compatible
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-3">
                          <PrimaryButton onClick={handleLaunchMinecraft} disabled={Boolean(clientStatus?.running)}>
                            ▶ Launch Minecraft
                          </PrimaryButton>
                          <PrimaryButton onClick={handleJoinServer} disabled={!isCompatible}>
                            Join Server
                          </PrimaryButton>
                          <SubtleButton onClick={() => setLauncherChoiceOpen(true)}>
                            Change launcher
                          </SubtleButton>
                          {forgeInstallersVisible && (
                            <SubtleButton onClick={handleOpenForgeDownload}>
                              Forge installers
                            </SubtleButton>
                          )}
                        </div>
                        {selectedServer && (
                          <p className="text-xs text-muted">
                            Required: {selectedServer.version} · {getServerTypeLabel(selectedServer.server_type)}. Use Launch Minecraft to open the launcher.
                          </p>
                        )}

                        {(versionMismatch || loaderMismatch) && clientStatus?.running && (
                          <div className="flex flex-wrap items-center gap-2">
                            <SubtleButton onClick={handleLaunchMinecraft}>Launch correct version</SubtleButton>
                            <SubtleButton onClick={() => setCompatHelpOpen(true)}>How to fix</SubtleButton>
                          </div>
                        )}
                        {supportsMods && modMismatch && (
                          <div className="flex flex-wrap items-center gap-2">
                            <PrimaryButton onClick={handleDownloadMissingMods} disabled={modSyncLoading}>
                              {modSyncLoading ? "Syncing..." : "Download missing mods"}
                            </PrimaryButton>
                            <SubtleButton onClick={handleSyncModsCheck}>Sync mods with server</SubtleButton>
                          </div>
                        )}
                        {supportsMods && (
                          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs uppercase tracking-[0.2em] text-muted">Mod sync</p>
                              <button
                                className="flex items-center gap-2 text-xs font-semibold text-muted transition hover:text-text"
                                onClick={openClientModsFolder}
                                type="button"
                              >
                                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 7h5l2 2h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                                </svg>
                                Client mods
                              </button>
                            </div>
                            {modpack && (
                              <p className="mt-2 text-xs text-muted">
                                Modpack: {modpack.mcVersion} · {formatLoaderLabel(modpack.loader)} · {modpack.mods.length} mods
                              </p>
                            )}
                            {modSync?.mods && modSync.mods.length > 0 ? (
                              <div className="mt-3 flex items-center justify-end gap-2">
                                <SubtleButton onClick={handleSyncModsCheck} disabled={modSyncLoading}>
                                  {modSyncLoading ? "Checking..." : "Check"}
                                </SubtleButton>
                                <SubtleButton onClick={() => setModSyncModalOpen(true)}>View mod list</SubtleButton>
                              </div>
                            ) : (
                              <div className="mt-3 flex items-center justify-between gap-2">
                                <p className="text-xs text-muted">No modpack data yet.</p>
                                <SubtleButton onClick={handleSyncModsCheck} disabled={modSyncLoading}>
                                  {modSyncLoading ? "Checking..." : "Check"}
                                </SubtleButton>
                              </div>
                            )}
                            {modSync?.mods?.some((entry) => entry.status === "unknown") && (
                              <p className="mt-3 text-xs text-muted">
                                Client mods were not detected. Add client mods manually and re-check sync.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>
                      </motion.div>
                    )}
                    {detailTab === "console" && (
                      <motion.div
                        key="console"
                        layout
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.2 }}
                      >
                    <Card title="Live Console">
                      <div className="grid gap-4">
                        <div className="h-72 overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-text">
                          {consoleLines.length === 0 ? (
                            <p className="text-muted">Server output will appear here.</p>
                          ) : (
                            consoleLines.map((line, index) => (
                              <p key={`${line}-${index}`} className="leading-relaxed">
                                {line}
                              </p>
                            ))
                          )}
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {["stop", "save-all", "list"].map((cmd) => (
                            <SubtleButton key={cmd} onClick={() => sendCommand(cmd)}>
                              {cmd}
                            </SubtleButton>
                          ))}
                        </div>
                        <div className="flex flex-col gap-3 md:flex-row">
                          <input
                            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
                            placeholder="Send a command to the server"
                            value={commandInput}
                            onChange={(event) => setCommandInput(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                sendCommand(commandInput);
                              }
                            }}
                          />
                          <PrimaryButton onClick={() => sendCommand(commandInput)}>Send</PrimaryButton>
                        </div>
                      </div>
                    </Card>
                      </motion.div>
                    )}
                    {detailTab === "settings" && (
                      <motion.div
                        key="settings"
                        layout
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.2 }}
                      >
                    <Card title="Server Settings">
                      <div className="grid gap-4">
                        <ServerSettingsFields
                          settings={activeSettings}
                          onChange={updateActiveSettings}
                          variant="basic"
                        />
                        <SettingRow
                          label="Online mode"
                          description="Turn off to allow non-official launchers. Restart required."
                        >
                          <span
                            className={classNames(
                              "rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
                              onlineModeDraft ? "bg-secondary/20 text-secondary" : "bg-white/10 text-muted"
                            )}
                          >
                            {onlineModeDraft ? "On" : "Off"}
                          </span>
                          <Switch.Root
                            checked={onlineModeDraft}
                            onCheckedChange={setOnlineModeDraft}
                            className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
                          >
                            <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
                          </Switch.Root>
                        </SettingRow>
                        <SettingRow
                          label="Automatic backups"
                          description="Run scheduled backups in the background."
                        >
                          <span
                            className={classNames(
                              "rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
                              serverMeta?.auto_backup ? "bg-secondary/20 text-secondary" : "bg-white/10 text-muted"
                            )}
                          >
                            {serverMeta?.auto_backup ? "On" : "Off"}
                          </span>
                          <Switch.Root
                            checked={serverMeta?.auto_backup ?? false}
                            onCheckedChange={(value) =>
                              saveServerMeta({
                                auto_backup: value,
                                backup_interval_minutes: serverMeta?.backup_interval_minutes ?? 60,
                                last_backup_at: serverMeta?.last_backup_at ?? null
                              })
                            }
                            className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-secondary"
                          >
                            <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
                          </Switch.Root>
                        </SettingRow>
                        {serverMeta?.auto_backup && (
                          <SettingRow label="Backup interval" description="Choose how often backups run.">
                            <Select.Root
                              value={String(serverMeta.backup_interval_minutes)}
                              onValueChange={(value) =>
                                saveServerMeta({
                                  auto_backup: true,
                                  backup_interval_minutes: Number(value),
                                  last_backup_at: serverMeta.last_backup_at ?? null
                                })
                              }
                            >
                              <Select.Trigger className="flex w-40 items-center justify-between rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold text-text transition focus:border-one/60 focus:outline-none">
                                <Select.Value />
                                <Select.Icon className="text-muted">▾</Select.Icon>
                              </Select.Trigger>
                              <Select.Portal>
                                <Select.Content
                                  position="popper"
                                  side="bottom"
                                  align="start"
                                  sideOffset={8}
                                  avoidCollisions={false}
                                  className="select-content z-50 overflow-hidden rounded-2xl border border-white/10 shadow-soft"
                                >
                                  <Select.Viewport className="bg-surface p-1">
                                    {BACKUP_INTERVALS.map((minutes) => (
                                      <Select.Item
                                        key={minutes}
                                        value={String(minutes)}
                                        className="cursor-pointer rounded-xl px-3 py-2 text-sm text-text outline-none data-highlighted:bg-white/15 data-highlighted:text-white"
                                      >
                                        <Select.ItemText>
                                          {minutes === 30
                                            ? "Every 30 minutes"
                                            : minutes === 60
                                            ? "Every 1 hour"
                                            : minutes === 360
                                            ? "Every 6 hours"
                                            : "Every 24 hours"}
                                        </Select.ItemText>
                                      </Select.Item>
                                    ))}
                                  </Select.Viewport>
                                </Select.Content>
                              </Select.Portal>
                            </Select.Root>
                          </SettingRow>
                        )}
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted">Settings update instantly for this server profile.</p>
                          <SubtleButton onClick={() => changeDetailTab("advanced")}>Advanced settings</SubtleButton>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted">Apply online-mode changes for this server.</p>
                          <PrimaryButton onClick={handleSaveConfig} disabled={configSaving}>
                            {configSaving ? "Saving..." : "Apply access"}
                          </PrimaryButton>
                        </div>
                      </div>
                    </Card>
                      </motion.div>
                    )}
                    {detailTab === "advanced" && (
                      <motion.div
                        key="advanced"
                        layout
                        className="grid gap-6 lg:grid-cols-[1.1fr_1fr]"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.2 }}
                      >
                    <Card title="Advanced Settings">
                      <div className="grid gap-4">
                        <ServerSettingsFields
                          settings={activeSettings}
                          onChange={updateActiveSettings}
                          variant="advanced"
                        />
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted">Need help?</p>
                          <p className="text-xs text-muted">Advanced settings are optional. Adjust only if you know the impact.</p>
                        </div>
                      </div>
                    </Card>
                    <Card title="Server Management">
                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted">RAM Allocation</p>
                          {systemRamGb && (
                            <p className="mt-2 text-xs text-muted">
                              You have {systemRamGb} GB RAM — we recommend {serverRecommendedRamGb ?? recommendedRamGb ?? systemRamGb} GB.
                            </p>
                          )}
                          {ramDraft === serverRecommendedRamGb && serverRecommendedRamGb && (
                            <p className="mt-2 text-xs text-muted">Recommended RAM selected.</p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {serverRamOptions.map((ram) => (
                              <button
                                key={ram}
                                className={classNames(
                                  "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition",
                                  ramDraft === ram ? "bg-one text-white" : "bg-white/10 text-text hover:bg-white/20",
                                  ram === serverRecommendedRamGb && ramDraft !== ram ? "ring-1 ring-one/40" : ""
                                )}
                                onClick={() => {
                                  setRamDraft(ram);
                                  setRamManualInput(String(ram));
                                }}
                                type="button"
                              >
                                <span>{ram} GB</span>
                              </button>
                            ))}
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-3">
                            <SubtleButton onClick={() => setRamManualOpen((prev) => !prev)}>
                              {ramManualOpen ? "Hide manual input" : "Choose RAM allocation manually"}
                            </SubtleButton>
                            {serverRecommendedRamGb && ramDraft !== serverRecommendedRamGb && (
                              <SubtleButton
                                className="bg-one/20 text-one ring-1 ring-one/40 hover:bg-one/25"
                                onClick={() => {
                                  setRamDraft(serverRecommendedRamGb);
                                  setRamManualInput(String(serverRecommendedRamGb));
                                }}
                              >
                                Use recommended
                              </SubtleButton>
                            )}
                            <span className="text-xs text-muted">Min 1 GB · Max {safeRamMaxGb} GB</span>
                          </div>
                          {ramManualOpen && (
                            <div className="mt-3 flex items-center gap-2">
                              <input
                                type="number"
                                min={1}
                                max={safeRamMaxGb}
                                value={ramManualInput}
                                onChange={(event) => {
                                  const raw = Number(event.target.value);
                                  const next = normalizeRamEven(
                                    Math.max(1, Math.min(safeRamMaxGb, Number.isFinite(raw) ? raw : 1))
                                  );
                                  setRamManualInput(String(next));
                                  setRamDraft(next);
                                }}
                                className="w-24 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-text focus:border-one/60 focus:outline-none"
                              />
                              <span className="text-xs text-muted">GB</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted">Apply RAM changes (backup + restart if running).</p>
                          <PrimaryButton onClick={handleApplyRam} disabled={configSaving}>
                            {configSaving ? "Saving..." : "Apply RAM"}
                          </PrimaryButton>
                        </div>
                      </div>
                    </Card>
                    <Card title="Reinstall Server">
                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted">Keep your world</p>
                          <p className="text-xs text-muted">Reinstalling keeps the world folder but resets server files.</p>
                        </div>
                        {selectedServer.server_type === "fabric" && (
                          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
                            Fabric reinstall via wizard is not supported yet. Import a new Fabric build instead.
                          </div>
                        )}
                        <div className="grid gap-2">
                          <label className="text-xs uppercase tracking-[0.2em] text-muted">New server type</label>
                          <Select.Root
                            value={reinstallType}
                            onValueChange={(value) => setReinstallType(value as ServerConfig["server_type"])}
                          >
                            <Select.Trigger className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none">
                              <Select.Value />
                              <Select.Icon className="text-muted">▾</Select.Icon>
                            </Select.Trigger>
                            <Select.Portal>
                              <Select.Content
                                position="popper"
                                side="bottom"
                                align="start"
                                sideOffset={8}
                                avoidCollisions={false}
                                className="select-content z-50 overflow-hidden rounded-2xl border border-white/10 shadow-soft"
                              >
                                <Select.Viewport className="bg-surface p-1">
                                  {SERVER_TYPES.map((type) => (
                                    <Select.Item
                                      key={type.value}
                                      value={type.value}
                                      className="cursor-pointer rounded-xl px-3 py-2 text-sm text-text outline-none data-highlighted:bg-white/15 data-highlighted:text-white"
                                    >
                                      <Select.ItemText>{type.label}</Select.ItemText>
                                    </Select.Item>
                                  ))}
                                </Select.Viewport>
                              </Select.Content>
                            </Select.Portal>
                          </Select.Root>
                        </div>
                        <div className="grid gap-2">
                          <label className="text-xs uppercase tracking-[0.2em] text-muted">Version</label>
                          <Select.Root value={reinstallVersion} onValueChange={setReinstallVersion}>
                            <Select.Trigger className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none">
                              <Select.Value />
                              <Select.Icon className="text-muted">▾</Select.Icon>
                            </Select.Trigger>
                            <Select.Portal>
                              <Select.Content
                                position="popper"
                                side="bottom"
                                align="start"
                                sideOffset={8}
                                avoidCollisions={false}
                                className="select-content z-50 overflow-hidden rounded-2xl border border-white/10 shadow-soft"
                              >
                                <div className="border-b border-white/10 bg-surface/95 p-2">
                                  <input
                                    className="w-full rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs text-text focus:border-one/60 focus:outline-none"
                                    placeholder={reinstallForgeLoading ? "Loading Forge versions..." : "Search versions"}
                                    value={reinstallVersionFilter}
                                    onChange={(event) => setReinstallVersionFilter(event.target.value)}
                                    disabled={reinstallForgeLoading}
                                  />
                                </div>
                                {reinstallVersionLimitHit && (
                                  <div className="border-b border-white/10 bg-surface/95 px-3 py-2 text-[10px] text-muted">
                                    Showing first {reinstallVersionLimit} versions. Type to search more.
                                  </div>
                                )}
                                <Select.Viewport className="bg-surface p-1">
                                  {reinstallFilteredVersionGroups.map((group) => (
                                    <Select.Group key={group.label}>
                                      <Select.Label className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                                        {group.label}
                                      </Select.Label>
                                      {group.versions.map((version) => (
                                        <Select.Item
                                          key={version.value}
                                          value={version.value}
                                          className="cursor-pointer rounded-xl px-3 py-2 text-sm text-text outline-none data-highlighted:bg-white/15 data-highlighted:text-white"
                                        >
                                          <div className="flex items-center justify-between gap-3">
                                            <Select.ItemText>{version.label ?? version.value}</Select.ItemText>
                                            {version.recommended && (
                                              <span className="rounded-full bg-one/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-one">
                                                Recommended
                                              </span>
                                            )}
                                          </div>
                                        </Select.Item>
                                      ))}
                                    </Select.Group>
                                  ))}
                                </Select.Viewport>
                              </Select.Content>
                            </Select.Portal>
                          </Select.Root>
                        </div>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-muted">Preserves the world folder only.</p>
                          <PrimaryButton
                            onClick={handleReinstallServer}
                            disabled={reinstallBusy || selectedServer.server_type === "fabric"}
                          >
                            {reinstallBusy ? "Reinstalling..." : "Reinstall server"}
                          </PrimaryButton>
                        </div>
                      </div>
                    </Card>
                    <Card title="Network Helper">
                      <div className="grid gap-4">
                        <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-xs uppercase tracking-[0.2em] text-muted">Local IP</p>
                              <p className="text-sm text-text">{network?.local_ip ?? "-"}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.2em] text-muted">Public IP</p>
                              <p className="text-sm text-text">{network?.public_ip ?? "-"}</p>
                            </div>
                            <div>
                              <p className="text-xs uppercase tracking-[0.2em] text-muted">Port status</p>
                              <p
                                className={classNames(
                                  "text-sm font-semibold",
                                  network?.port_open ? "text-secondary" : "text-danger"
                                )}
                              >
                                {network?.port_open ? "Open" : "Closed"}
                              </p>
                            </div>
                            <SubtleButton onClick={refreshNetwork}>Refresh</SubtleButton>
                          </div>
                          <p className="text-xs text-muted">Port forwarding is needed for friends outside your network.</p>
                        </div>
                        {!network?.port_open && (
                          <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                            <p className="text-sm font-semibold text-text">Port closed. Use a secure VPN tunnel:</p>
                            <div className="flex flex-wrap gap-2">
                              <SubtleButton onClick={() => openUrl("https://www.vpn.net/")}>Hamachi</SubtleButton>
                              <SubtleButton onClick={() => openUrl("https://www.radmin-vpn.com/")}>Radmin VPN</SubtleButton>
                              <SubtleButton onClick={() => openUrl("https://tailscale.com/")}>Tailscale</SubtleButton>
                            </div>
                            <ol className="grid gap-2 text-xs text-muted">
                              <li>1. Install a VPN app and create a private network.</li>
                              <li>2. Share the VPN join link with friends.</li>
                              <li>3. Start the Minecraft server and share your VPN IP.</li>
                            </ol>
                          </div>
                        )}
                      </div>
                    </Card>
                    <div data-tutorial="backups-card">
                      <Card title="Backups & Export">
                        <div className="grid gap-4">
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted">World data</p>
                          <p className="text-xs text-muted">Create manual backups or export the world for hosting.</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-2 text-xs text-muted">
                            <input
                              type="checkbox"
                              checked={backupIncludeNether}
                              onChange={(event) => setBackupIncludeNether(event.target.checked)}
                            />
                            Include Nether
                          </label>
                          <label className="flex items-center gap-2 text-xs text-muted">
                            <input
                              type="checkbox"
                              checked={backupIncludeEnd}
                              onChange={(event) => setBackupIncludeEnd(event.target.checked)}
                            />
                            Include The End
                          </label>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <PrimaryButton onClick={handleCreateBackup}>
                            {backupProgress !== null ? "Backing up..." : "Create backup"}
                          </PrimaryButton>
                          <SubtleButton onClick={handleExportWorld}>
                            {exportProgress !== null ? "Exporting..." : "Export world"}
                          </SubtleButton>
                          <SubtleButton onClick={handleOpenBackupsFolder}>
                            Open backups folder
                          </SubtleButton>
                        </div>
                        {backupProgress !== null && (
                          <div className="grid gap-2">
                            <p className="text-xs text-muted">Backup {backupProgress.toFixed(0)}%</p>
                            <SegmentedBar value={backupProgress} tone="secondary" />
                          </div>
                        )}
                        {exportProgress !== null && (
                          <div className="grid gap-2">
                            <p className="text-xs text-muted">Export {exportProgress.toFixed(0)}%</p>
                            <SegmentedBar value={exportProgress} tone="primary" />
                          </div>
                        )}
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs uppercase tracking-[0.2em] text-muted">Available backups</p>
                            {backupsLoading && <span className="text-xs text-muted">Loading...</span>}
                          </div>
                          {backups.length === 0 ? (
                            <p className="mt-2 text-xs text-muted">No backups created yet.</p>
                          ) : (
                            <div className="mt-3 grid gap-2">
                              {backups.map((entry) => (
                                <div
                                  key={entry.id}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                                >
                                  <div>
                                    <p className="text-sm text-text">{new Date(entry.created_at).toLocaleString()}</p>
                                    <p className="text-xs text-muted">{(entry.size_bytes / 1024 / 1024).toFixed(1)} MB</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <SubtleButton onClick={() => handleRestoreBackup(entry)}>Restore</SubtleButton>
                                    <SubtleButton onClick={() => handleDeleteBackup(entry)} className="text-danger">
                                      Delete
                                    </SubtleButton>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        </div>
                      </Card>
                    </div>
                    {(selectedServer.server_type === "forge" || selectedServer.server_type === "fabric") && (
                      <Card title="Mods">
                        <div className="grid gap-4">
                          <div
                            className="rounded-2xl border border-dashed border-white/20 bg-white/5 px-4 py-6 text-center text-sm text-muted transition hover:border-one/40"
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={handleModDrop}
                          >
                            Drag & drop .jar mods here to install (Modrinth/CurseForge URL required)
                          </div>
                          {modsLoading ? (
                            <p className="text-xs text-muted">Loading mods...</p>
                          ) : mods.length === 0 ? (
                            <p className="text-xs text-muted">No mods installed yet.</p>
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs text-muted">Mods: {mods.length}</p>
                              <SubtleButton onClick={() => setModsModalOpen(true)}>View mod list</SubtleButton>
                            </div>
                          )}
                        </div>
                      </Card>
                    )}
                    <Card title="Delete Server">
                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-danger">Irreversible</p>
                          <p className="text-xs text-muted">This will remove all server files and configuration.</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <p className="text-xs uppercase tracking-[0.2em] text-muted">Server name</p>
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <span className="text-sm text-text">{selectedServer.name}</span>
                            <SubtleButton
                              onClick={() => navigator.clipboard?.writeText(selectedServer.name)}
                              className="bg-white/10 text-muted hover:bg-white/20"
                            >
                              Copy
                            </SubtleButton>
                          </div>
                        </div>
                        <input
                          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-danger/60 focus:outline-none"
                          placeholder="Type server name to delete"
                          value={deleteConfirm}
                          onChange={(event) => setDeleteConfirm(event.target.value)}
                        />
                        <button
                          className={classNames(
                            "rounded-full bg-danger px-4 py-2 text-xs font-semibold text-white transition",
                            detailDeleteMatches ? "hover:bg-danger/90" : "opacity-50"
                          )}
                          onClick={() => handleDeleteServer(selectedServer)}
                          disabled={!detailDeleteMatches || deleteBusy}
                        >
                          {deleteBusy ? "Deleting..." : "Delete server"}
                        </button>
                      </div>
                    </Card>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Tabs.Root>
              </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
