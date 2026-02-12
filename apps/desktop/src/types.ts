export type View = "loading" | "welcome" | "library" | "servers" | "wizard" | "migration" | "detail" | "settings";

export type ServerStatus = "STOPPED" | "STARTING" | "RUNNING" | "ERROR";

export type ServerConfig = {
  name: string;
  server_type: "vanilla" | "paper" | "forge" | "fabric";
  version: string;
  ram_gb: number;
  online_mode: boolean;
  port: number;
  server_dir: string;
  linked?: boolean;
};

export type ResourceUsage = {
  cpu_percent: number;
  memory_mb: number;
  memory_limit_mb: number;
};

export type ModEntry = {
  name: string;
  enabled: boolean;
  file_name: string;
};

export type ModpackEntry = {
  id: string;
  version: string;
  sha256: string;
  url: string;
};

export type ModpackManifest = {
  mcVersion: string;
  loader: string;
  mods: ModpackEntry[];
};

export type ModSyncEntry = {
  id: string;
  version: string;
  status: "installed" | "missing" | "conflict" | "unknown";
};

export type ModSyncStatus = {
  mcVersion: string;
  loader: string;
  mods: ModSyncEntry[];
};

export type NetworkInfo = {
  local_ip: string;
  public_ip: string;
  port_open: boolean;
};

export type ApplyResult = {
  applied: boolean;
  pending_restart: boolean;
};

export type JavaStatusResult = {
  status: "ready" | "missing" | "unsupported";
  required_major: number;
  selected_path?: string | null;
  selected_major?: number | null;
  system_path?: string | null;
  system_major?: number | null;
  runtime_path?: string | null;
  runtime_major?: number | null;
};

export type LauncherChoice = "official" | "tlauncher";

export type ImportAnalysis = {
  suggested_name: string;
  server_type: ServerConfig["server_type"];
  detected_version: string;
  jar_path: string;
  has_properties: boolean;
  has_world: boolean;
  has_nether: boolean;
  has_end: boolean;
  detected_ram_gb?: number | null;
  warnings: string[];
};

export type WorldImportMode = "generate" | "import";

export type WorldSourceKind = "folder" | "zip";

export type WorldValidationResult = {
  valid: boolean;
  source_kind: WorldSourceKind;
  world_name: string;
  world_path: string;
  staged_path?: string | null;
  size_bytes: number;
  has_level_dat: boolean;
  has_region: boolean;
  has_playerdata: boolean;
  has_data: boolean;
  has_dim_nether: boolean;
  has_dim_end: boolean;
  detected_version?: string | null;
  detected_type?: "vanilla" | "forge" | null;
};

export type WorldCopyProgress = {
  server_name: string;
  total_bytes: number;
  copied_bytes: number;
  percent: number;
};

export type WorldImportPayload = {
  source_path: string;
  source_kind: WorldSourceKind;
  staged_path?: string | null;
};

export type ModsImportMode = "skip" | "zip" | "folder";

export type ModsValidationResult = {
  valid: boolean;
  source_kind: WorldSourceKind;
  mods_path: string;
  staged_path?: string | null;
  mod_count: number;
  detected_pack?: "modrinth" | "curseforge" | null;
};

export type ModsImportPayload = {
  source_path: string;
  source_kind: WorldSourceKind;
  staged_path?: string | null;
};

export type BackupEntry = {
  id: string;
  created_at: string;
  size_bytes: number;
  path: string;
};

export type MinecraftClientStatus = {
  running: boolean;
  mcVersion?: string | null;
  loader?: string | null;
  pid?: number | null;
};

export type ClientVersionInfo = {
  versionId: string;
  mcVersion: string;
  loader: string;
};

export type ClientDetectionResult = {
  running: boolean;
  versionId: string | null;
  mcVersion: string | null;
  loader: string | null;
  pid: number | null;
};

export type AppSettings = {
  analytics_enabled: boolean;
  crash_reporting_enabled: boolean;
  analytics_endpoint?: string | null;
  launcher_path?: string | null;
  smart_join_panel_enabled?: boolean;
  notify_on_server_start?: boolean;
  mod_sync_mode?: "ask" | "metadata" | "copy";
};

export type UpdateInfo = {
  update_available: boolean;
  latest_version?: string | null;
  download_url?: string | null;
};

export type CrashReportSummary = {
  file_name: string;
  timestamp: string;
  message: string;
};

export type CrashReport = {
  timestamp: string;
  app_version: string;
  os: string;
  message: string;
  backtrace: string;
};

export type ServerMeta = {
  auto_backup: boolean;
  backup_interval_minutes: number;
  last_backup_at?: string | null;
};

export type ServerMetadata = {
  loader: string;
  mcVersion: string;
  modCount: number;
  moddedWorld: boolean;
  modpack?: string | null;
  detectedAt: string;
};

export type Difficulty = "Peaceful" | "Easy" | "Normal" | "Hard";

export type GameMode = "Survival" | "Creative" | "Adventure" | "Spectator";

export type ServerSettings = {
  sleepPlayers: number;
  difficulty: Difficulty;
  gameMode: GameMode;
  pvp: boolean;
  allowFlight: boolean;
  maxPlayers: number;
  viewDistance: number;
};

export type VersionEntry = { value: string; label?: string; recommended?: boolean };

export type VersionGroup = { label: string; versions: VersionEntry[] };
