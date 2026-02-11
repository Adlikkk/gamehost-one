use std::fs::{self, File};
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use fastnbt::from_bytes;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use base64::{engine::general_purpose, Engine as _};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use sysinfo::{Pid, System};
use tauri::{AppHandle, Manager, State};
use tauri::{Emitter, WindowEvent};
use urlencoding::encode;
use walkdir::WalkDir;
use zip::{ZipArchive, ZipWriter, write::FileOptions};

#[cfg(target_os = "windows")]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;

#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE,
    DWM_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND, DWMWCP_ROUND,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
enum ServerType {
    Vanilla,
    Paper,
    Forge,
    Fabric,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ServerStatus {
    STOPPED,
    STARTING,
    RUNNING,
    ERROR,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum LauncherConfig {
    Jar { jar_path: String },
    Forge { args_file: String },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ServerConfig {
    name: String,
    server_type: ServerType,
    version: String,
    ram_gb: u8,
    online_mode: bool,
    port: u16,
    server_dir: String,
    launcher: LauncherConfig,
    #[serde(default)]
    linked: bool,
}

#[derive(Debug, Deserialize)]
struct ServerConfigInput {
    name: String,
    #[serde(rename = "server_type", alias = "serverType")]
    server_type: ServerType,
    version: String,
    #[serde(rename = "ram_gb", alias = "ramGb")]
    ram_gb: u8,
    #[serde(rename = "online_mode", alias = "onlineMode")]
    online_mode: bool,
    port: u16,
    #[serde(default, rename = "world_import", alias = "worldImport")]
    world_import: Option<WorldImportInput>,
    #[serde(default, rename = "mod_import", alias = "modImport")]
    mod_import: Option<ModsImportInput>,
}

#[derive(Debug, Deserialize)]
struct WorldImportInput {
    #[serde(rename = "source_path", alias = "sourcePath")]
    source_path: String,
    #[serde(rename = "source_kind", alias = "sourceKind")]
    source_kind: String,
    #[serde(rename = "staged_path", alias = "stagedPath")]
    staged_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModsImportInput {
    #[serde(rename = "source_path", alias = "sourcePath")]
    source_path: String,
    #[serde(rename = "source_kind", alias = "sourceKind")]
    source_kind: String,
    #[serde(rename = "staged_path", alias = "stagedPath")]
    staged_path: Option<String>,
}

#[derive(Debug, Serialize)]
struct WorldValidationResult {
    valid: bool,
    source_kind: String,
    world_name: String,
    world_path: String,
    staged_path: Option<String>,
    size_bytes: u64,
    has_level_dat: bool,
    has_region: bool,
    has_playerdata: bool,
    has_data: bool,
    has_dim_nether: bool,
    has_dim_end: bool,
    detected_version: Option<String>,
    detected_type: Option<String>,
}

#[derive(Debug, Serialize)]
struct ModsValidationResult {
    valid: bool,
    source_kind: String,
    mods_path: String,
    staged_path: Option<String>,
    mod_count: usize,
    detected_pack: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct WorldCopyProgress {
    server_name: String,
    total_bytes: u64,
    copied_bytes: u64,
    percent: u8,
}

#[derive(Debug, Deserialize)]
struct ImportRequest {
    #[serde(rename = "source_path", alias = "sourcePath")]
    source_path: String,
    name: String,
    mode: String,
}

#[derive(Debug, Serialize)]
struct ImportAnalysis {
    suggested_name: String,
    server_type: ServerType,
    detected_version: String,
    jar_path: String,
    has_properties: bool,
    has_world: bool,
    has_nether: bool,
    has_end: bool,
    detected_ram_gb: Option<u8>,
    warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ServerMeta {
    #[serde(rename = "auto_backup", alias = "autoBackup")]
    auto_backup: bool,
    #[serde(rename = "backup_interval_minutes", alias = "backupIntervalMinutes")]
    backup_interval_minutes: u32,
    #[serde(rename = "last_backup_at", alias = "lastBackupAt")]
    last_backup_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct ServerMetadata {
    loader: String,
    #[serde(rename = "mcVersion")]
    mc_version: String,
    #[serde(rename = "modCount")]
    mod_count: usize,
    #[serde(rename = "moddedWorld")]
    modded_world: bool,
    modpack: Option<String>,
    #[serde(rename = "detectedAt")]
    detected_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct JavaConfig {
    java_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppSettings {
    analytics_enabled: bool,
    crash_reporting_enabled: bool,
    analytics_endpoint: Option<String>,
    launcher_path: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            analytics_enabled: false,
            crash_reporting_enabled: false,
            analytics_endpoint: None,
            launcher_path: None,
        }
    }
}

#[derive(Debug, Serialize)]
struct UpdateInfo {
    update_available: bool,
    latest_version: Option<String>,
    download_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CrashReport {
    timestamp: String,
    app_version: String,
    os: String,
    message: String,
    backtrace: String,
}

#[derive(Debug, Serialize)]
struct CrashReportSummary {
    file_name: String,
    timestamp: String,
    message: String,
}

#[derive(Debug, Serialize)]
struct JavaStatusResult {
    status: String,
    required_major: u32,
    selected_path: Option<String>,
    selected_major: Option<u32>,
    system_path: Option<String>,
    system_major: Option<u32>,
    runtime_path: Option<String>,
    runtime_major: Option<u32>,
}

impl Default for ServerMeta {
    fn default() -> Self {
        Self {
            auto_backup: false,
            backup_interval_minutes: 60,
            last_backup_at: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BackupEntry {
    id: String,
    created_at: String,
    size_bytes: u64,
    path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct ServerRegistry {
    servers: Vec<ServerConfig>,
}

#[derive(Debug, Deserialize)]
struct UpdateConfigInput {
    #[serde(rename = "server_id", alias = "serverId")]
    server_id: String,
    #[serde(rename = "ram_gb", alias = "ramGb")]
    ram_gb: u8,
    #[serde(rename = "online_mode", alias = "onlineMode")]
    online_mode: bool,
}

#[derive(Debug, Serialize)]
struct ResourceUsage {
    cpu_percent: f32,
    memory_mb: f32,
    memory_limit_mb: f32,
}

#[derive(Debug, Serialize)]
struct NetworkInfo {
    local_ip: String,
    public_ip: String,
    port_open: bool,
}

#[derive(Debug, Serialize)]
struct ModEntry {
    name: String,
    enabled: bool,
    file_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ModpackEntry {
    id: String,
    version: String,
    sha256: String,
    url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ModpackManifest {
    #[serde(rename = "mcVersion")]
    mc_version: String,
    loader: String,
    mods: Vec<ModpackEntry>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeManifest {
    minecraft: CurseForgeMinecraft,
    files: Vec<CurseForgeFile>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeMinecraft {
    version: String,
    #[serde(rename = "modLoaders")]
    mod_loaders: Vec<CurseForgeModLoader>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeModLoader {
    id: String,
    primary: bool,
}

#[derive(Debug, Deserialize)]
struct CurseForgeFile {
    #[serde(rename = "projectID")]
    project_id: u64,
    #[serde(rename = "fileID")]
    file_id: u64,
}

#[derive(Debug, Deserialize)]
struct ModrinthIndex {
    dependencies: std::collections::HashMap<String, String>,
    files: Vec<ModrinthFile>,
}

#[derive(Debug, Deserialize)]
struct ModrinthFile {
    path: String,
    hashes: std::collections::HashMap<String, String>,
    downloads: Vec<String>,
}

#[derive(Debug, Serialize)]
struct ModSyncEntry {
    id: String,
    version: String,
    status: String,
}

#[derive(Debug, Serialize)]
struct ModSyncStatus {
    #[serde(rename = "mcVersion")]
    mc_version: String,
    loader: String,
    mods: Vec<ModSyncEntry>,
}

#[derive(Debug, Serialize)]
struct MinecraftClientStatus {
    running: bool,
    #[serde(rename = "mcVersion")]
    mc_version: Option<String>,
    loader: Option<String>,
    pid: Option<u32>,
}

#[derive(Debug, Serialize)]
struct ClientVersionInfo {
    #[serde(rename = "versionId")]
    version_id: String,
    #[serde(rename = "mcVersion")]
    mc_version: String,
    loader: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ServerSettings {
    #[serde(rename = "required_sleeping_players", alias = "sleepPlayers")]
    required_sleeping_players: u8,
    #[serde(rename = "difficulty")]
    difficulty: String,
    #[serde(rename = "gamemode", alias = "gameMode")]
    gamemode: String,
    #[serde(rename = "pvp")]
    pvp: bool,
    #[serde(rename = "max_players", alias = "maxPlayers")]
    max_players: u16,
    #[serde(rename = "view_distance", alias = "viewDistance")]
    view_distance: u8,
}

impl Default for ServerSettings {
    fn default() -> Self {
        Self {
            required_sleeping_players: 1,
            difficulty: "normal".to_string(),
            gamemode: "survival".to_string(),
            pvp: true,
            max_players: 20,
            view_distance: 10,
        }
    }
}

#[derive(Debug, Serialize)]
struct ApplyResult {
    applied: bool,
    pending_restart: bool,
}

struct ProcessManager {
    status: ServerStatus,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    pid: Option<u32>,
    started_at: Option<Instant>,
    active_server_id: Option<String>,
}

impl ProcessManager {
    fn new() -> Self {
        Self {
            status: ServerStatus::STOPPED,
            child: None,
            stdin: None,
            pid: None,
            started_at: None,
            active_server_id: None,
        }
    }

    fn status(&self) -> ServerStatus {
        self.status
    }

    fn pid(&self) -> Option<u32> {
        self.pid
    }

    fn start(
        &mut self,
        app: &AppHandle,
        config: &ServerConfig,
        process: Arc<Mutex<ProcessManager>>,
        java_exe: &Path,
    ) -> Result<(), String> {
        if matches!(self.status, ServerStatus::RUNNING | ServerStatus::STARTING) {
            return Ok(());
        }

        let server_dir = PathBuf::from(&config.server_dir);
        let mut command = Command::new(java_exe);
        command
            .current_dir(&server_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        match &config.launcher {
            LauncherConfig::Jar { jar_path } => {
                let jar_abs = server_dir.join(jar_path);
                if !jar_abs.exists() {
                    return Err("Server jar is missing. Recreate the server or redownload files.".to_string());
                }
                command
                    .arg(format!("-Xms{}G", config.ram_gb))
                    .arg(format!("-Xmx{}G", config.ram_gb))
                    .arg("-jar")
                    .arg(jar_path)
                    .arg("nogui");
            }
            LauncherConfig::Forge { args_file } => {
                let args_abs = server_dir.join(args_file);
                if !args_abs.exists() {
                    return Err("Forge args file is missing. Reinstall the server.".to_string());
                }
                write_user_jvm_args(&server_dir, config.ram_gb)?;
                command
                    .arg("@user_jvm_args.txt")
                    .arg(format!("@{}", args_file))
                    .arg("nogui");
            }
        }

        self.status = ServerStatus::STARTING;
        self.started_at = Some(Instant::now());
        self.active_server_id = Some(config.name.clone());
        emit_status(app, self.status);
        emit_server_event(app, "server:start");

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(err) => {
                self.status = ServerStatus::ERROR;
                emit_status(app, self.status);
                emit_server_event(app, "server:error");
                if err.kind() == ErrorKind::NotFound {
                    return Err("Java was not found. Install Java 17+ and try again.".to_string());
                }
                return Err(err.to_string());
            }
        };
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture server stdout")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Failed to capture server stderr")?;

        let stdin = child.stdin.take();
        self.pid = Some(child.id());
        self.stdin = stdin;
        self.child = Some(child);
        spawn_output_thread(app.clone(), process.clone(), stdout, "stdout");
        spawn_output_thread(app.clone(), process, stderr, "stderr");

        Ok(())
    }

    fn stop(&mut self, app: &AppHandle) -> Result<(), String> {
        if self.child.is_none() {
            self.status = ServerStatus::STOPPED;
            self.active_server_id = None;
            emit_status(app, self.status);
            return Ok(());
        }

        if let Some(stdin) = self.stdin.as_mut() {
            let _ = writeln!(stdin, "stop");
        }

        let start = Instant::now();
        loop {
            if let Some(child) = self.child.as_mut() {
                if let Ok(Some(_)) = child.try_wait() {
                    break;
                }
            }

            if start.elapsed() > Duration::from_secs(10) {
                if let Some(child) = self.child.as_mut() {
                    let _ = child.kill();
                }
                break;
            }

            std::thread::sleep(Duration::from_millis(200));
        }

        self.child = None;
        self.stdin = None;
        self.pid = None;
        self.started_at = None;
        self.status = ServerStatus::STOPPED;
        self.active_server_id = None;
        emit_status(app, self.status);
        emit_server_event(app, "server:stopped");
        Ok(())
    }

    fn send_command(&mut self, command: &str) -> Result<(), String> {
        let stdin = self.stdin.as_mut().ok_or("Server is not running")?;
        writeln!(stdin, "{}", command).map_err(|err| err.to_string())?;
        Ok(())
    }
}

struct AppState {
    data_dir: PathBuf,
    registry_path: PathBuf,
    legacy_config_path: PathBuf,
    process: Arc<Mutex<ProcessManager>>,
}

static TRAY_READY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn get_server_config(state: State<AppState>) -> Result<ServerConfig, String> {
    let registry = load_registry(&state.registry_path, &state.legacy_config_path)?;
    registry
        .servers
        .first()
        .cloned()
        .ok_or("Server not configured".to_string())
}

#[tauri::command]
fn create_server(config: ServerConfigInput, state: State<AppState>, app: AppHandle) -> Result<ServerConfig, String> {
    let mut registry = load_registry(&state.registry_path, &state.legacy_config_path)?;
    let server_name = sanitize_name(&config.name);
    if registry
        .servers
        .iter()
        .any(|server| sanitize_name(&server.name) == server_name)
    {
        return Err("Server name is already in use".to_string());
    }

    let server_dir = state.data_dir.join("servers").join(&server_name);
    fs::create_dir_all(&server_dir).map_err(|err| err.to_string())?;

    let java_exe = if matches!(config.server_type, ServerType::Forge) {
        Some(java_executable_for_version(&config.version, &state.data_dir)?)
    } else {
        None
    };
    let launcher = install_server(&config, &server_dir, java_exe.as_deref())?;
    write_server_properties(&server_dir, config.port, config.online_mode)?;
    write_eula(&server_dir)?;

    if let Some(world_import) = &config.world_import {
        import_world_into_server(&server_dir, &server_name, world_import, &state, &app)?;
    }
    if let Some(mods_import) = &config.mod_import {
        import_mods_into_server(&server_dir, mods_import, &state)?;
    }

    if let Ok(metadata) = scan_server_metadata(&server_dir) {
        let _ = save_server_metadata(&server_dir, &metadata);
    }

    let final_config = ServerConfig {
        name: config.name,
        server_type: config.server_type,
        version: config.version,
        ram_gb: config.ram_gb,
        online_mode: config.online_mode,
        port: config.port,
        server_dir: server_dir.to_string_lossy().to_string(),
        launcher,
        linked: false,
    };

    registry.servers.push(final_config.clone());
    save_registry(&state.registry_path, &registry)?;
    let settings = load_app_settings(&state.data_dir);
    log_analytics_event(&state.data_dir, &settings, "server_created");
    Ok(final_config)
}

#[tauri::command]
fn list_servers(state: State<AppState>) -> Result<Vec<ServerConfig>, String> {
    let registry = load_registry(&state.registry_path, &state.legacy_config_path)?;
    Ok(registry.servers)
}

#[tauri::command]
fn get_active_server_id(state: State<AppState>) -> Result<Option<String>, String> {
    let manager = state
        .process
        .lock()
        .map_err(|_| "Failed to lock process state")?;
    Ok(manager.active_server_id.clone())
}

#[tauri::command]
fn start_server(server_id: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let registry = load_registry(&state.registry_path, &state.legacy_config_path)?;
    let config = get_server_by_id(&registry, &server_id).ok_or("Server not found")?;
    let server_dir = PathBuf::from(&config.server_dir);
    let settings = load_settings(&server_dir)?;
    apply_settings_to_properties(&server_dir, &settings)?;
    let process = state.process.clone();
    let mut manager = process
        .lock()
        .map_err(|_| "Failed to lock process state")?;
    if manager
        .active_server_id
        .as_deref()
        .is_some_and(|active| active != server_id)
    {
        return Err("Another server is currently running".to_string());
    }
    let java_exe = java_executable_for_version(&config.version, &state.data_dir)?;
    manager.start(&app, &config, process.clone(), &java_exe)?;
    drop(manager);
    spawn_exit_watcher(process, app.clone());
    Ok(())
}

#[tauri::command]
fn stop_server(server_id: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let mut manager = state
        .process
        .lock()
        .map_err(|_| "Failed to lock process state")?;
    if manager
        .active_server_id
        .as_deref()
        .is_some_and(|active| active != server_id)
    {
        return Err("Another server is currently running".to_string());
    }
    manager.stop(&app)
}

#[tauri::command]
fn restart_server(server_id: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    {
        let mut manager = state
            .process
            .lock()
            .map_err(|_| "Failed to lock process state")?;
        if manager
            .active_server_id
            .as_deref()
            .is_some_and(|active| active != server_id)
        {
            return Err("Another server is currently running".to_string());
        }
        manager.stop(&app)?;
    }
    start_server(server_id, state, app)
}

#[tauri::command]
fn send_console_command(server_id: String, command: String, state: State<AppState>) -> Result<(), String> {
    let mut manager = state
        .process
        .lock()
        .map_err(|_| "Failed to lock process state")?;
    if manager
        .active_server_id
        .as_deref()
        .is_some_and(|active| active != server_id)
    {
        return Err("Server is not running".to_string());
    }
    manager.send_command(&command)
}

#[tauri::command]
fn get_status(server_id: String, state: State<AppState>) -> Result<ServerStatus, String> {
    let mut manager = state
        .process
        .lock()
        .map_err(|_| "Failed to lock process state")?;
    if manager
        .active_server_id
        .as_deref()
        .is_some_and(|active| active != server_id)
    {
        return Ok(ServerStatus::STOPPED);
    }
    if let Some(pid) = manager.pid() {
        let mut system = System::new_all();
        system.refresh_process(Pid::from_u32(pid));
        if system.process(Pid::from_u32(pid)).is_some() {
            if matches!(manager.status(), ServerStatus::STOPPED | ServerStatus::ERROR) {
                manager.status = ServerStatus::RUNNING;
            }
            if matches!(manager.status(), ServerStatus::STARTING) {
                if let Some(started_at) = manager.started_at {
                    if started_at.elapsed() > Duration::from_secs(8) {
                        manager.status = ServerStatus::RUNNING;
                    }
                }
            }
        }
    }
    Ok(manager.status())
}

#[tauri::command]
fn get_resource_usage(server_id: String, state: State<AppState>) -> Result<ResourceUsage, String> {
    let pid = {
        let manager = state
            .process
            .lock()
            .map_err(|_| "Failed to lock process state")?;
        if manager
            .active_server_id
            .as_deref()
            .is_some_and(|active| active != server_id)
        {
            return Err("Server is not running".to_string());
        }
        manager.pid()
    };

    let pid = pid.ok_or("Server is not running")?;
    let mut system = System::new_all();
    system.refresh_process(Pid::from_u32(pid));
    let process = system
        .process(Pid::from_u32(pid))
        .ok_or("Unable to read process usage")?;

    let memory_mb = process.memory() as f32 / 1024.0;
    let cpu_percent = process.cpu_usage();

    let registry = load_registry(&state.registry_path, &state.legacy_config_path)?;
    let config = get_server_by_id(&registry, &server_id).ok_or("Server not found")?;
    let memory_limit_mb = config.ram_gb as f32 * 1024.0;

    Ok(ResourceUsage {
        cpu_percent,
        memory_mb,
        memory_limit_mb,
    })
}

#[tauri::command]
fn get_network_info(port: u16) -> Result<NetworkInfo, String> {
    let local_ip = local_ip_address::local_ip()
        .map_err(|err| err.to_string())?
        .to_string();

    let public_ip = fetch_public_ip()?;
    let port_open = check_port_open(&public_ip, port);

    Ok(NetworkInfo {
        local_ip,
        public_ip,
        port_open,
    })
}

#[tauri::command]
fn get_system_ram() -> Result<f32, String> {
    let mut system = System::new_all();
    system.refresh_memory();
    Ok(system.total_memory() as f32 / 1024.0)
}

#[tauri::command]
fn check_java(server_version: String, state: State<AppState>) -> Result<JavaStatusResult, String> {
    let required = required_java_major(&server_version);
    let config = load_java_config(&state.data_dir);
    Ok(build_java_status(required, &state.data_dir, &config))
}

#[tauri::command]
fn set_java_path(
    java_path: String,
    server_version: String,
    state: State<AppState>,
) -> Result<JavaStatusResult, String> {
    let path = PathBuf::from(java_path);
    if !path.exists() {
        return Err("Selected Java path does not exist".to_string());
    }
    let _ = java_major_from_path(&path)?;

    let mut config = load_java_config(&state.data_dir);
    config.java_path = Some(path.to_string_lossy().to_string());
    save_java_config(&state.data_dir, &config)?;

    let required = required_java_major(&server_version);
    Ok(build_java_status(required, &state.data_dir, &config))
}

#[tauri::command]
fn download_java(
    server_version: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<JavaStatusResult, String> {
    let required = required_java_major(&server_version);
    let java_exe = download_java_runtime(required, &state.data_dir, &app)?;
    let mut config = load_java_config(&state.data_dir);
    config.java_path = Some(java_exe.to_string_lossy().to_string());
    save_java_config(&state.data_dir, &config)?;
    Ok(build_java_status(required, &state.data_dir, &config))
}

#[tauri::command]
fn update_server_config(payload: UpdateConfigInput, state: State<AppState>) -> Result<ApplyResult, String> {
    let mut registry = load_registry(&state.registry_path, &state.legacy_config_path)?;
    let (server_dir, ram_gb, online_mode) = {
        let config = registry
            .servers
            .iter_mut()
            .find(|server| server_matches_id(server, &payload.server_id))
            .ok_or("Server not found")?;

        config.ram_gb = payload.ram_gb;
        config.online_mode = payload.online_mode;

        (config.server_dir.clone(), config.ram_gb, config.online_mode)
    };

    save_registry(&state.registry_path, &registry)?;

    let server_dir = PathBuf::from(&server_dir);
    write_user_jvm_args(&server_dir, ram_gb)?;
    apply_online_mode(&server_dir, online_mode)?;

    let running = is_server_running(&state)?;
    Ok(ApplyResult {
        applied: !running,
        pending_restart: running,
    })
}

#[tauri::command]
fn delete_server(server_id: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let server_dir = resolve_server_dir(&state, &server_id)?;
    let mut linked = false;
    let running = is_server_running(&state)?;
    if running {
        let mut manager = state
            .process
            .lock()
            .map_err(|_| "Failed to lock process state")?;
        if manager
            .active_server_id
            .as_deref()
            .is_some_and(|active| active != server_id)
        {
            return Err("Another server is currently running".to_string());
        }
        manager.stop(&app)?;
    }

    if let Ok(registry) = load_registry(&state.registry_path, &state.legacy_config_path) {
        if let Some(config) = get_server_by_id(&registry, &server_id) {
            linked = config.linked;
        }
    }

    if server_dir.exists() && !linked {
        fs::remove_dir_all(&server_dir).map_err(|err| err.to_string())?;
    }

    let mut registry = load_registry(&state.registry_path, &state.legacy_config_path)?;
    registry
        .servers
        .retain(|server| !server_matches_id(server, &server_id));
    save_registry(&state.registry_path, &registry)?;
    append_log(&state.data_dir, &format!("Server deleted: {}", server_id));
    Ok(())
}

#[tauri::command]
fn reinstall_server(
    server_id: String,
    server_type: ServerType,
    version: String,
    state: State<AppState>,
    app: AppHandle,
) -> Result<ServerConfig, String> {
    let mut registry = load_registry(&state.registry_path, &state.legacy_config_path)?;
    let index = registry
        .servers
        .iter()
        .position(|server| server_matches_id(server, &server_id))
        .ok_or("Server not found")?;
    let (server_name, ram_gb, online_mode, port, server_dir_string) = {
        let config = &registry.servers[index];
        (
            config.name.clone(),
            config.ram_gb,
            config.online_mode,
            config.port,
            config.server_dir.clone(),
        )
    };

    let running = is_server_running(&state)?;
    if running {
        let mut manager = state
            .process
            .lock()
            .map_err(|_| "Failed to lock process state")?;
        if manager
            .active_server_id
            .as_deref()
            .is_some_and(|active| active != server_id)
        {
            return Err("Another server is currently running".to_string());
        }
        manager.stop(&app)?;
    }

    let server_dir = PathBuf::from(&server_dir_string);
    let world_dir = server_dir.join("world");
    let preserve_world = world_dir.exists();
    let temp_root = state.data_dir.join("temp");
    let temp_world = temp_root.join(format!("world_{}", sanitize_name(&server_name)));

    if preserve_world {
        fs::create_dir_all(&temp_root).map_err(|err| err.to_string())?;
        if temp_world.exists() {
            fs::remove_dir_all(&temp_world).map_err(|err| err.to_string())?;
        }
        fs::rename(&world_dir, &temp_world).map_err(|err| err.to_string())?;
    }

    if server_dir.exists() {
        fs::remove_dir_all(&server_dir).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(&server_dir).map_err(|err| err.to_string())?;

    let reinstall_input = ServerConfigInput {
        name: server_name.clone(),
        server_type: server_type.clone(),
        version: version.clone(),
        ram_gb,
        online_mode,
        port,
        world_import: None,
        mod_import: None,
    };

    let java_exe = if matches!(server_type, ServerType::Forge) {
        Some(java_executable_for_version(&version, &state.data_dir)?)
    } else {
        None
    };
    let launcher = install_server(&reinstall_input, &server_dir, java_exe.as_deref())?;
    write_server_properties(&server_dir, port, online_mode)?;
    write_eula(&server_dir)?;

    if preserve_world {
        fs::rename(&temp_world, server_dir.join("world")).map_err(|err| err.to_string())?;
    }

    let updated = {
        let config = &mut registry.servers[index];
        config.server_type = server_type;
        config.version = version;
        config.launcher = launcher;
        config.server_dir = server_dir.to_string_lossy().to_string();
        config.clone()
    };

    save_registry(&state.registry_path, &registry)?;
    Ok(updated)
}

#[tauri::command]
fn analyze_server_folder_cmd(source_path: String) -> Result<ImportAnalysis, String> {
    analyze_server_folder(Path::new(&source_path))
}

#[tauri::command]
fn import_server(request: ImportRequest, state: State<AppState>, app: AppHandle) -> Result<ServerConfig, String> {
    let analysis = analyze_server_folder(Path::new(&request.source_path))?;
    let mut registry = load_registry(&state.registry_path, &state.legacy_config_path)?;

    let sanitized = sanitize_name(&request.name);
    if registry
        .servers
        .iter()
        .any(|server| sanitize_name(&server.name) == sanitized)
    {
        return Err("Server name is already in use".to_string());
    }

    let source_dir = PathBuf::from(&request.source_path);
    let target_dir = if request.mode == "copy" {
        let destination = state.data_dir.join("servers").join(&sanitized);
        copy_dir_recursive(&source_dir, &destination)?;
        destination
    } else if request.mode == "link" {
        source_dir.clone()
    } else {
        return Err("Invalid import mode".to_string());
    };

    let jar_source = PathBuf::from(&analysis.jar_path);
    let jar_relative = jar_source.strip_prefix(&source_dir).unwrap_or(&jar_source);
    let jar_target = target_dir.join(jar_relative);
    let jar_config_path = jar_target
        .strip_prefix(&target_dir)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|_| jar_target.to_string_lossy().to_string());

    let (port, online_mode) = read_port_and_online_mode(&target_dir);
    let ram_gb = analysis.detected_ram_gb.unwrap_or(4);

    let launcher = if matches!(analysis.server_type, ServerType::Forge) {
        if let Some(args_file) = find_forge_args_file(&target_dir) {
            LauncherConfig::Forge { args_file }
        } else {
            LauncherConfig::Jar {
                jar_path: jar_config_path.clone(),
            }
        }
    } else {
        LauncherConfig::Jar {
            jar_path: jar_config_path.clone(),
        }
    };

    let final_config = ServerConfig {
        name: request.name,
        server_type: analysis.server_type,
        version: analysis.detected_version,
        ram_gb,
        online_mode,
        port,
        server_dir: target_dir.to_string_lossy().to_string(),
        launcher,
        linked: request.mode == "link",
    };

    registry.servers.push(final_config.clone());
    save_registry(&state.registry_path, &registry)?;
    if let Ok(metadata) = scan_server_metadata(&target_dir) {
        let _ = save_server_metadata(&target_dir, &metadata);
    }
    let settings = load_app_settings(&state.data_dir);
    log_analytics_event(&state.data_dir, &settings, "server_created");
    append_log(&state.data_dir, &format!("Imported server: {}", final_config.name));
    let _ = app.emit("server:imported", final_config.name.clone());
    Ok(final_config)
}

#[tauri::command]
fn get_server_meta(server_id: String, state: State<AppState>) -> Result<ServerMeta, String> {
    load_server_meta(&state.data_dir, &server_id)
}

#[tauri::command]
fn get_server_metadata(server_id: String, state: State<AppState>) -> Result<Option<ServerMetadata>, String> {
    let server_dir = resolve_server_dir(&state, &server_id)?;
    Ok(load_server_metadata(&server_dir))
}

#[tauri::command]
fn detect_server_metadata(server_id: String, state: State<AppState>) -> Result<ServerMetadata, String> {
    let server_dir = resolve_server_dir(&state, &server_id)?;
    let metadata = scan_server_metadata(&server_dir)?;
    let _ = save_server_metadata(&server_dir, &metadata);
    Ok(metadata)
}

#[tauri::command]
fn update_server_meta(server_id: String, meta: ServerMeta, state: State<AppState>) -> Result<(), String> {
    save_server_meta(&state.data_dir, &server_id, &meta)
}

#[tauri::command]
fn export_world(
    server_id: String,
    destination: String,
    include_nether: bool,
    include_end: bool,
    state: State<AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let server_dir = resolve_server_dir(&state, &server_id)?;
    let running = is_server_running(&state)?;
    if running {
        let mut manager = state
            .process
            .lock()
            .map_err(|_| "Failed to lock process state")?;
        if manager
            .active_server_id
            .as_deref()
            .is_some_and(|active| active != server_id)
        {
            return Err("Another server is currently running".to_string());
        }
        manager.stop(&app)?;
    }

    let destination = PathBuf::from(destination);
    zip_world_to_path(&server_dir, &destination, include_nether, include_end, Some(&app), "export:progress", &server_id)?;
    append_log(&state.data_dir, &format!("Exported world for server: {}", server_id));
    Ok(())
}

#[tauri::command]
fn create_backup(
    server_id: String,
    include_nether: bool,
    include_end: bool,
    reason: Option<String>,
    state: State<AppState>,
    app: AppHandle,
) -> Result<BackupEntry, String> {
    let reason_label = reason.unwrap_or_else(|| "manual".to_string());
    perform_backup(&app, &state, &server_id, include_nether, include_end, &reason_label)
}

#[tauri::command]
fn list_backups(server_id: String, state: State<AppState>) -> Result<Vec<BackupEntry>, String> {
    load_backup_manifest(&state.data_dir, &server_id)
}

#[tauri::command]
fn delete_backup(server_id: String, backup_id: String, state: State<AppState>) -> Result<(), String> {
    let mut manifest = load_backup_manifest(&state.data_dir, &server_id)?;
    if let Some(entry) = manifest.iter().find(|entry| entry.id == backup_id) {
        let _ = fs::remove_file(&entry.path);
    }
    manifest.retain(|entry| entry.id != backup_id);
    save_backup_manifest(&state.data_dir, &server_id, &manifest)?;
    append_log(&state.data_dir, &format!("Backup deleted: {}", backup_id));
    Ok(())
}

#[tauri::command]
fn restore_backup(server_id: String, backup_id: String, state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let server_dir = resolve_server_dir(&state, &server_id)?;
    let running = is_server_running(&state)?;
    if running {
        let mut manager = state
            .process
            .lock()
            .map_err(|_| "Failed to lock process state")?;
        if manager
            .active_server_id
            .as_deref()
            .is_some_and(|active| active != server_id)
        {
            return Err("Another server is currently running".to_string());
        }
        manager.stop(&app)?;
    }

    let manifest = load_backup_manifest(&state.data_dir, &server_id)?;
    let entry = manifest
        .iter()
        .find(|entry| entry.id == backup_id)
        .ok_or("Backup not found")?;

    let zip_file = File::open(&entry.path).map_err(|err| err.to_string())?;
    let mut archive = zip::ZipArchive::new(zip_file).map_err(|err| err.to_string())?;

    for folder in ["world", "world_nether", "world_the_end"] {
        let path = server_dir.join(folder);
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|err| err.to_string())?;
        }
    }

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|err| err.to_string())?;
        let outpath = server_dir.join(file.name());
        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|err| err.to_string())?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            let mut outfile = File::create(&outpath).map_err(|err| err.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|err| err.to_string())?;
        }
    }

    append_log(&state.data_dir, &format!("Backup restored: {}", backup_id));
    Ok(())
}

#[tauri::command]
fn list_mods(server_id: String, state: State<AppState>) -> Result<Vec<ModEntry>, String> {
    let server_dir = resolve_server_dir(&state, &server_id)?;
    let mods_dir = server_dir.join("mods");
    if !mods_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&mods_dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !file_name.ends_with(".jar") && !file_name.ends_with(".jar.disabled") {
            continue;
        }
        let enabled = file_name.ends_with(".jar");
        let name = file_name
            .trim_end_matches(".disabled")
            .trim_end_matches(".jar")
            .to_string();
        entries.push(ModEntry {
            name,
            enabled,
            file_name,
        });
    }

    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
fn add_mod(server_id: String, source_path: String, state: State<AppState>) -> Result<(), String> {
    let server_dir = resolve_server_dir(&state, &server_id)?;
    let mods_dir = server_dir.join("mods");
    fs::create_dir_all(&mods_dir).map_err(|err| err.to_string())?;

    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("Mod file not found".to_string());
    }
    if source.extension().and_then(|s| s.to_str()) != Some("jar") {
        return Err("Only .jar mods are supported".to_string());
    }

    let file_name = source
        .file_name()
        .ok_or("Invalid mod file name")?
        .to_string_lossy()
        .to_string();
    let destination = mods_dir.join(file_name);
    fs::copy(&source, &destination).map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_forge_versions() -> Result<Vec<String>, String> {
    let client = reqwest::blocking::Client::new();
    let response = client
        .get("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml")
        .send()
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err("Unable to fetch Forge versions".to_string());
    }

    let text = response.text().map_err(|err| err.to_string())?;
    let mut versions = Vec::new();
    for chunk in text.split("<version>").skip(1) {
        if let Some(end) = chunk.find("</version>") {
            let value = chunk[..end].trim();
            if !value.is_empty() {
                versions.push(value.to_string());
            }
        }
    }

    if versions.is_empty() {
        return Err("No Forge versions found".to_string());
    }

    versions.sort_by(|a, b| parse_forge_version(b).cmp(&parse_forge_version(a)));
    Ok(versions)
}

fn parse_forge_version(value: &str) -> (u32, u32, u32, u32) {
    let mut mc_major = 0u32;
    let mut mc_minor = 0u32;
    let mut mc_patch = 0u32;
    let mut forge_build = 0u32;

    let mut parts = value.split('-');
    if let Some(mc) = parts.next() {
        let mut mc_parts = mc.split('.');
        mc_major = mc_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        mc_minor = mc_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
        mc_patch = mc_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    }
    if let Some(build) = parts.next() {
        let mut build_parts = build.split('.');
        forge_build = build_parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    }

    (mc_major, mc_minor, mc_patch, forge_build)
}

#[tauri::command]
fn toggle_mod(server_id: String, file_name: String, enabled: bool, state: State<AppState>) -> Result<(), String> {
    let server_dir = resolve_server_dir(&state, &server_id)?;
    let mods_dir = server_dir.join("mods");
    let current = mods_dir.join(&file_name);
    if !current.exists() {
        return Err("Mod not found".to_string());
    }

    let next = if enabled {
        PathBuf::from(file_name.trim_end_matches(".disabled"))
    } else if file_name.ends_with(".jar") {
        PathBuf::from(format!("{}.disabled", file_name))
    } else {
        PathBuf::from(&file_name)
    };

    if next == PathBuf::from(&file_name) {
        return Ok(());
    }

    fs::rename(current, mods_dir.join(next)).map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_mod_with_meta(
    server_id: String,
    source_path: String,
    mod_id: String,
    mod_version: String,
    url: String,
    state: State<AppState>,
) -> Result<ModpackManifest, String> {
    let registry = load_registry(&state.registry_path, &state.legacy_config_path)?;
    let config = registry
        .servers
        .iter()
        .find(|server| server_matches_id(server, &server_id))
        .ok_or("Server not found")?
        .clone();
    let server_dir = PathBuf::from(&config.server_dir);
    let mods_dir = server_dir.join("mods");
    fs::create_dir_all(&mods_dir).map_err(|err| err.to_string())?;

    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("Mod file not found".to_string());
    }
    if source.extension().and_then(|s| s.to_str()) != Some("jar") {
        return Err("Only .jar mods are supported".to_string());
    }
    if mod_id.trim().is_empty() || mod_version.trim().is_empty() {
        return Err("Mod id and version are required".to_string());
    }

    is_allowed_mod_url(&url)?;

    let file_name = source
        .file_name()
        .ok_or("Invalid mod file name")?
        .to_string_lossy()
        .to_string();
    let destination = mods_dir.join(&file_name);
    fs::copy(&source, &destination).map_err(|err| err.to_string())?;

    let sha256 = sha256_file(&destination)?;
    let mut manifest = load_modpack(&server_dir, &config)?;
    manifest
        .mods
        .retain(|entry| !entry.id.eq_ignore_ascii_case(mod_id.trim()));
    manifest.mods.push(ModpackEntry {
        id: mod_id.trim().to_string(),
        version: mod_version.trim().to_string(),
        sha256,
        url: url.trim().to_string(),
    });
    save_modpack(&server_dir, &manifest)?;
    Ok(manifest)
}

#[tauri::command]
fn get_modpack(server_id: String, state: State<AppState>) -> Result<ModpackManifest, String> {
    let registry = load_registry(&state.registry_path, &state.legacy_config_path)?;
    let config = get_server_by_id(&registry, &server_id).ok_or("Server not found")?;
    let server_dir = PathBuf::from(&config.server_dir);
    let manifest = load_modpack(&server_dir, &config)?;
    if !modpack_path(&server_dir).exists() {
        save_modpack(&server_dir, &manifest)?;
    }
    Ok(manifest)
}

#[tauri::command]
fn check_mod_sync(server_id: String, state: State<AppState>) -> Result<ModSyncStatus, String> {
    let registry = load_registry(&state.registry_path, &state.legacy_config_path)?;
    let config = get_server_by_id(&registry, &server_id).ok_or("Server not found")?;
    let server_dir = PathBuf::from(&config.server_dir);
    let manifest = load_modpack(&server_dir, &config)?;

    let mods_dir = client_mods_dir().unwrap_or_else(|_| PathBuf::from(""));
    let mut client_hashes = Vec::new();
    let mut client_files = Vec::new();
    let mut has_client_mods = false;
    if mods_dir.exists() {
        for entry in fs::read_dir(&mods_dir).map_err(|err| err.to_string())? {
            let entry = entry.map_err(|err| err.to_string())?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            if !file_name.ends_with(".jar") {
                continue;
            }
            has_client_mods = true;
            if let Ok(hash) = sha256_file(&path) {
                client_hashes.push(hash);
                client_files.push(file_name.to_lowercase());
            }
        }
    }

    let mut mods = Vec::new();
    for entry in manifest.mods.iter() {
        let mut status = if !has_client_mods || entry.url.trim().is_empty() {
            "unknown".to_string()
        } else {
            "missing".to_string()
        };
        if client_hashes.iter().any(|hash| hash == &entry.sha256) {
            status = "installed".to_string();
        } else if client_files.iter().any(|name| name.contains(&entry.id.to_lowercase())) {
            status = "conflict".to_string();
        }
        mods.push(ModSyncEntry {
            id: entry.id.clone(),
            version: entry.version.clone(),
            status,
        });
    }

    Ok(ModSyncStatus {
        mc_version: manifest.mc_version,
        loader: manifest.loader,
        mods,
    })
}

#[tauri::command]
fn download_mods(
    server_id: String,
    mod_ids: Vec<String>,
    state: State<AppState>,
) -> Result<(), String> {
    let registry = load_registry(&state.registry_path, &state.legacy_config_path)?;
    let config = get_server_by_id(&registry, &server_id).ok_or("Server not found")?;
    let server_dir = PathBuf::from(&config.server_dir);
    let manifest = load_modpack(&server_dir, &config)?;
    let mods_dir = client_mods_dir()?;
    fs::create_dir_all(&mods_dir).map_err(|err| err.to_string())?;

    let target_ids: Vec<String> = mod_ids.into_iter().map(|id| id.to_lowercase()).collect();
    let client_hashes = if mods_dir.exists() {
        fs::read_dir(&mods_dir)
            .map_err(|err| err.to_string())?
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.path().is_file())
            .filter_map(|entry| sha256_file(&entry.path()).ok())
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let mut downloaded = 0usize;
    for entry in manifest.mods.iter() {
        if !target_ids.is_empty() && !target_ids.contains(&entry.id.to_lowercase()) {
            continue;
        }
        if client_hashes.iter().any(|hash| hash == &entry.sha256) {
            continue;
        }
        if entry.url.trim().is_empty() {
            continue;
        }
        is_allowed_mod_url(&entry.url)?;
        let file_name = filename_from_url(&entry.url)?;
        let destination = mods_dir.join(&file_name);
        if destination.exists() {
            continue;
        }
        let client = reqwest::blocking::Client::new();
        download_with_sha256(&client, &entry.url, &entry.sha256, &destination)?;
        downloaded += 1;
    }

    if !target_ids.is_empty() && downloaded == 0 {
        return Err("Modpack entries do not include downloadable URLs.".to_string());
    }

    Ok(())
}

#[tauri::command]
fn detect_minecraft_client() -> Result<MinecraftClientStatus, String> {
    let mut system = System::new_all();
    system.refresh_processes();
    for (pid, process) in system.processes() {
        let name = process.name().to_ascii_lowercase();
        if name != "java.exe" && name != "javaw.exe" && name != "java" {
            continue;
        }

        let args = process.cmd();
        let joined = args.join(" ");
        if !joined.contains(".minecraft") && !joined.contains("net.minecraft.client") {
            continue;
        }

        let mut mc_version = None;
        let mut loader = None;

        for (index, arg) in args.iter().enumerate() {
            if arg == "--version" {
                if let Some(next) = args.get(index + 1) {
                    mc_version = Some(next.clone());
                }
            }
            if let Some(value) = arg.strip_prefix("--version=") {
                mc_version = Some(value.to_string());
            }
            if let Some(value) = arg.strip_prefix("fml.mcVersion=") {
                mc_version = Some(value.to_string());
            }
            if let Some(value) = arg.strip_prefix("fabric.gameVersion=") {
                mc_version = Some(value.to_string());
            }
        }

        let lower = joined.to_lowercase();
        if lower.contains("fabric") {
            loader = Some("fabric".to_string());
        } else if lower.contains("forge") || lower.contains("fml") {
            loader = Some("forge".to_string());
        }

        return Ok(MinecraftClientStatus {
            running: true,
            mc_version,
            loader,
            pid: Some(pid.as_u32()),
        });
    }

    if let Some((mc_version, loader)) = parse_latest_log() {
        return Ok(MinecraftClientStatus {
            running: false,
            mc_version: Some(mc_version),
            loader: Some(loader),
            pid: None,
        });
    }

    Ok(MinecraftClientStatus {
        running: false,
        mc_version: None,
        loader: None,
        pid: None,
    })
}

#[cfg(target_os = "windows")]
fn try_open_protocol(url: &str) -> Result<(), String> {
    Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[cfg(target_os = "windows")]
fn candidate_paths_for_launcher(choice: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let program_files = std::env::var("PROGRAMFILES").ok();
    let program_files_x86 = std::env::var("PROGRAMFILES(X86)").ok();
    let local_appdata = std::env::var("LOCALAPPDATA").ok();
    let appdata = std::env::var("APPDATA").ok();
    let system_drive = std::env::var("SYSTEMDRIVE").ok();

    match choice {
        "official" => {
            if let Some(base) = program_files_x86.as_ref() {
                paths.push(PathBuf::from(base).join("Minecraft Launcher").join("MinecraftLauncher.exe"));
            }
            if let Some(base) = program_files.as_ref() {
                paths.push(PathBuf::from(base).join("Minecraft Launcher").join("MinecraftLauncher.exe"));
            }
            if let Some(base) = local_appdata.as_ref() {
                paths.push(
                    PathBuf::from(base)
                        .join("Programs")
                        .join("Minecraft Launcher")
                        .join("MinecraftLauncher.exe"),
                );
            }
            if let Some(base) = appdata.as_ref() {
                paths.push(PathBuf::from(base).join(".minecraft").join("launcher").join("minecraft.exe"));
            }
            if let Some(base) = system_drive.as_ref() {
                paths.push(
                    PathBuf::from(base)
                        .join("XboxGames")
                        .join("Minecraft Launcher")
                        .join("Content")
                        .join("Minecraft.exe"),
                );
            }
        }
        "tlauncher" => {
            if let Some(base) = appdata.as_ref() {
                paths.push(PathBuf::from(base).join(".minecraft").join("TLauncher.exe"));
                paths.push(PathBuf::from(base).join(".tlauncher").join("TLauncher.exe"));
            }
            if let Some(base) = local_appdata.as_ref() {
                paths.push(PathBuf::from(base).join("TLauncher").join("TLauncher.exe"));
            }
            if let Some(base) = program_files_x86.as_ref() {
                paths.push(PathBuf::from(base).join("TLauncher").join("TLauncher.exe"));
            }
            if let Some(base) = program_files.as_ref() {
                paths.push(PathBuf::from(base).join("TLauncher").join("TLauncher.exe"));
            }
        }
        _ => {}
    }

    paths
}

#[cfg(target_os = "windows")]
fn try_spawn_launcher(path: &Path) -> Result<(), String> {
    Command::new(path)
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[cfg(target_os = "windows")]
fn try_spawn_custom_launcher(path: &str) -> Result<(), String> {
    let exe = PathBuf::from(path);
    if !exe.exists() {
        return Err("Launcher path not found".to_string());
    }
    try_spawn_launcher(&exe)
}

#[cfg(target_os = "windows")]
fn try_launch_official_appx() -> Result<(), String> {
    let app_ids = [
        "shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!MinecraftLauncher",
        "shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft",
    ];
    for app_id in app_ids {
        if Command::new("cmd")
            .args(["/C", "start", "", app_id])
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }
    Err("Unable to launch Minecraft from AppsFolder.".to_string())
}

#[tauri::command]
fn launch_minecraft(
    choice: String,
    version: Option<String>,
    server_name: Option<String>,
    state: State<AppState>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let normalized = choice.to_lowercase();
        let settings = load_app_settings(&state.data_dir);
        if let Some(path) = settings.launcher_path.as_deref() {
            if try_spawn_custom_launcher(path).is_ok() {
                return Ok(());
            }
        }
        if normalized == "official" {
            if let Some(version) = version.as_ref() {
                let _ = ensure_launcher_profile(version, server_name.as_deref());
            }
        }
        let candidates = candidate_paths_for_launcher(&normalized);
        for path in candidates {
            if !path.exists() {
                continue;
            }
            if try_spawn_launcher(&path).is_ok() {
                return Ok(());
            }
        }

        if normalized == "official" {
            if try_launch_official_appx().is_ok() {
                return Ok(());
            }
            if let Some(version) = version.as_ref() {
                if let Ok(profile_name) = ensure_launcher_profile(version, server_name.as_deref()) {
                    let url = format!("minecraft://launch/?launchProfile={}", encode(&profile_name));
                    if try_open_protocol(&url).is_ok() {
                        return Ok(());
                    }
                }
                if client_version_installed(version) {
                    let url = format!("minecraft://launch/?version={}", encode(version));
                    if try_open_protocol(&url).is_ok() {
                        return Ok(());
                    }
                }
            }
            if try_open_protocol("minecraft://").is_ok() {
                return Ok(());
            }
        }

        return Err("Minecraft launcher not found.".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = choice;
        let _ = version;
        Err("Launcher integration is currently supported on Windows only.".to_string())
    }
}

#[tauri::command]
fn get_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    let base = app_data_dir(&app)?;
    ensure_app_dirs(&base)?;
    Ok(load_app_settings(&base))
}

#[tauri::command]
fn update_app_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let base = app_data_dir(&app)?;
    ensure_app_dirs(&base)?;
    save_app_settings(&base, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn list_crash_reports(app: AppHandle) -> Result<Vec<CrashReportSummary>, String> {
    let base = app_data_dir(&app)?;
    ensure_app_dirs(&base)?;
    let dir = crashes_dir(&base);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut reports = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let report: CrashReport = match serde_json::from_str(&content) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let file_name = match path.file_name().and_then(|name| name.to_str()) {
            Some(value) => value.to_string(),
            None => continue,
        };
        reports.push(CrashReportSummary {
            file_name,
            timestamp: report.timestamp,
            message: report.message,
        });
    }

    reports.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(reports)
}

#[tauri::command]
fn get_crash_report(file_name: String, app: AppHandle) -> Result<CrashReport, String> {
    let base = app_data_dir(&app)?;
    ensure_app_dirs(&base)?;
    let path = crashes_dir(&base).join(file_name);
    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    serde_json::from_str(&content).map_err(|err| err.to_string())
}

#[tauri::command]
fn delete_crash_report(file_name: String, app: AppHandle) -> Result<(), String> {
    let base = app_data_dir(&app)?;
    ensure_app_dirs(&base)?;
    let path = crashes_dir(&base).join(file_name);
    if path.exists() {
        fs::remove_file(&path).map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn clear_crash_reports(app: AppHandle) -> Result<(), String> {
    let base = app_data_dir(&app)?;
    ensure_app_dirs(&base)?;
    let dir = crashes_dir(&base);
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(&dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
fn export_crash_reports(destination: String, app: AppHandle) -> Result<String, String> {
    if destination.trim().is_empty() {
        return Err("Missing export path".to_string());
    }
    let base = app_data_dir(&app)?;
    ensure_app_dirs(&base)?;
    let dir = crashes_dir(&base);
    if !dir.exists() {
        return Err("No crash reports to export".to_string());
    }

    let entries = fs::read_dir(&dir).map_err(|err| err.to_string())?;
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
            files.push(path);
        }
    }
    if files.is_empty() {
        return Err("No crash reports to export".to_string());
    }

    let destination_path = PathBuf::from(destination.trim());
    if let Some(parent) = destination_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }

    let file = File::create(&destination_path).map_err(|err| err.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default();

    for path in files {
        let name = match path.file_name().and_then(|value| value.to_str()) {
            Some(value) => value,
            None => continue,
        };
        let content = fs::read(&path).map_err(|err| err.to_string())?;
        zip.start_file(name, options).map_err(|err| err.to_string())?;
        zip.write_all(&content).map_err(|err| err.to_string())?;
    }

    zip.finish().map_err(|err| err.to_string())?;
    Ok(destination_path.to_string_lossy().to_string())
}

#[tauri::command]
fn check_for_updates(repo: String, app: AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    let mut info = UpdateInfo {
        update_available: false,
        latest_version: None,
        download_url: None,
    };

    if repo.trim().is_empty() {
        return Ok(info);
    }

    let url = format!("https://api.github.com/repos/{}/releases/latest", repo.trim());
    let client = reqwest::blocking::Client::builder()
        .user_agent("GameHostOne")
        .build()
        .map_err(|err| err.to_string())?;
    let response = client.get(url).send().map_err(|err| err.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(info);
    }
    if !response.status().is_success() {
        return Err(format!("Update check failed with {}", response.status()));
    }
    let payload: serde_json::Value = response.json().map_err(|err| err.to_string())?;
    let tag = payload
        .get("tag_name")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if tag.is_empty() {
        return Ok(info);
    }
    let latest_version = tag.trim_start_matches('v').to_string();
    info.latest_version = Some(latest_version.clone());
    if !is_newer_version(&current_version, &latest_version) {
        return Ok(info);
    }

    info.update_available = true;
    let download_url = payload
        .get("assets")
        .and_then(|value| value.as_array())
        .and_then(|assets| {
            assets
                .iter()
                .filter_map(|asset| asset.get("browser_download_url").and_then(|url| url.as_str()))
                .find(|url| url.to_ascii_lowercase().ends_with(".msi"))
                .map(|value| value.to_string())
                .or_else(|| {
                    assets
                        .iter()
                        .filter_map(|asset| asset.get("browser_download_url").and_then(|url| url.as_str()))
                        .next()
                        .map(|value| value.to_string())
                })
        });
    info.download_url = download_url;
    Ok(info)
}

#[tauri::command]
fn download_update(download_url: String, app: AppHandle) -> Result<String, String> {
    if download_url.trim().is_empty() {
        return Err("Missing download URL".to_string());
    }
    let base = app_data_dir(&app)?;
    ensure_app_dirs(&base)?;
    let updates_dir = base.join("updates");
    fs::create_dir_all(&updates_dir).map_err(|err| err.to_string())?;

    let file_name = filename_from_url(&download_url).unwrap_or_else(|_| "update.msi".to_string());
    let destination = updates_dir.join(file_name);
    let client = reqwest::blocking::Client::new();
    let mut response = client.get(&download_url).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Download failed with {}", response.status()));
    }
    let mut file = File::create(&destination).map_err(|err| err.to_string())?;
    response.copy_to(&mut file).map_err(|err| err.to_string())?;
    Ok(destination.to_string_lossy().to_string())
}

#[tauri::command]
fn get_server_settings(server_id: String, state: State<AppState>) -> Result<ServerSettings, String> {
    let server_dir = resolve_server_dir(&state, &server_id)?;
    let settings = load_settings(&server_dir)?;
    Ok(settings)
}

#[tauri::command]
fn update_server_settings(
    server_id: String,
    settings: ServerSettings,
    state: State<AppState>,
) -> Result<ApplyResult, String> {
    let server_dir = resolve_server_dir(&state, &server_id)?;
    save_settings(&server_dir, &settings)?;

    let running = is_server_running(&state)?;
    if running {
        return Ok(ApplyResult {
            applied: false,
            pending_restart: true,
        });
    }

    apply_settings_to_properties(&server_dir, &settings)?;
    Ok(ApplyResult {
        applied: true,
        pending_restart: false,
    })
}

#[tauri::command]
fn apply_server_settings(server_id: String, state: State<AppState>) -> Result<ApplyResult, String> {
    let server_dir = resolve_server_dir(&state, &server_id)?;
    let settings = load_settings(&server_dir)?;

    let running = is_server_running(&state)?;
    if running {
        apply_settings_to_properties(&server_dir, &settings)?;
        return Ok(ApplyResult {
            applied: false,
            pending_restart: true,
        });
    }

    apply_settings_to_properties(&server_dir, &settings)?;
    Ok(ApplyResult {
        applied: true,
        pending_restart: false,
    })
}

fn spawn_exit_watcher(process: Arc<Mutex<ProcessManager>>, app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(1000));
        let mut manager = match process.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };

        if let Some(child) = manager.child.as_mut() {
            if let Ok(Some(exit_status)) = child.try_wait() {
                manager.child = None;
                manager.stdin = None;
                manager.pid = None;
                manager.active_server_id = None;
                manager.status = if exit_status.success() {
                    ServerStatus::STOPPED
                } else {
                    ServerStatus::ERROR
                };
                emit_status(&app, manager.status);
                if exit_status.success() {
                    emit_server_event(&app, "server:stopped");
                } else {
                    emit_server_event(&app, "server:error");
                }
                break;
            }
        } else {
            break;
        }
    });
}

fn emit_status(app: &AppHandle, status: ServerStatus) {
    let _ = app.emit("status_change", status);
}

fn emit_server_event(app: &AppHandle, event: &str) {
    let _ = app.emit(event, ());
}

fn spawn_output_thread(
    app: AppHandle,
    process: Arc<Mutex<ProcessManager>>,
    stream: impl std::io::Read + Send + 'static,
    label: &str,
) {
    let label = label.to_string();
    std::thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().flatten() {
            let payload = format!("[{}] {}", label, line);
            let _ = app.emit("console_line", payload);

            if label == "stdout" && line.contains("Done (") {
                if let Ok(mut manager) = process.lock() {
                    if matches!(manager.status, ServerStatus::STARTING) {
                        manager.status = ServerStatus::RUNNING;
                        emit_status(&app, manager.status);
                        emit_server_event(&app, "server:ready");
                    }
                }
            }
        }
    });
}

#[cfg(target_os = "windows")]
fn apply_window_corner_preference_from_handle(handle: &impl HasWindowHandle, should_round: bool) {
    let preference = if should_round {
        DWMWCP_ROUND
    } else {
        DWMWCP_DONOTROUND
    };
    let transparent: u32 = 0x00000000;

    // Best-effort: ignore any DWM errors to avoid impacting app behavior.
    if let Ok(handle) = handle.window_handle() {
        if let RawWindowHandle::Win32(handle) = handle.as_raw() {
            let hwnd = HWND(handle.hwnd.get() as _);
            let _ = unsafe {
                DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_WINDOW_CORNER_PREFERENCE,
                    &preference as *const DWM_WINDOW_CORNER_PREFERENCE as _,
                    std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
                )
            };
            let _ = unsafe {
                DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_BORDER_COLOR,
                    &transparent as *const u32 as _,
                    std::mem::size_of::<u32>() as u32,
                )
            };
            let _ = unsafe {
                DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_CAPTION_COLOR,
                    &transparent as *const u32 as _,
                    std::mem::size_of::<u32>() as u32,
                )
            };
        }
    }
}

#[cfg(target_os = "windows")]
fn apply_window_corner_preference(window: &tauri::Window) {
    let should_round = !(window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false));
    apply_window_corner_preference_from_handle(window, should_round);
}

#[cfg(target_os = "windows")]
fn apply_webview_corner_preference(window: &tauri::WebviewWindow) {
    let should_round = !(window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false));
    apply_window_corner_preference_from_handle(window, should_round);
}

#[cfg(not(target_os = "windows"))]
fn apply_window_corner_preference(_window: &tauri::Window) {}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| err.to_string())
}

fn ensure_app_dirs(base: &Path) -> Result<(), String> {
    fs::create_dir_all(base.join("servers")).map_err(|err| err.to_string())?;
    fs::create_dir_all(base.join("configs")).map_err(|err| err.to_string())?;
    fs::create_dir_all(base.join("logs")).map_err(|err| err.to_string())?;
    fs::create_dir_all(base.join("backups")).map_err(|err| err.to_string())?;
    fs::create_dir_all(base.join("runtime").join("java")).map_err(|err| err.to_string())?;
    fs::create_dir_all(base.join("crashes")).map_err(|err| err.to_string())?;
    Ok(())
}

fn java_config_path(base: &Path) -> PathBuf {
    base.join("configs").join("java.json")
}

fn app_settings_path(base: &Path) -> PathBuf {
    base.join("configs").join("settings.json")
}

fn analytics_path(base: &Path) -> PathBuf {
    base.join("analytics.json")
}

fn crashes_dir(base: &Path) -> PathBuf {
    base.join("crashes")
}

fn runtime_java_dir(base: &Path) -> PathBuf {
    base.join("runtime").join("java")
}

fn runtime_java_exe(base: &Path) -> PathBuf {
    let binary = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
    runtime_java_dir(base).join("bin").join(binary)
}

fn load_java_config(base: &Path) -> JavaConfig {
    let path = java_config_path(base);
    if !path.exists() {
        return JavaConfig::default();
    }
    let content = match fs::read_to_string(&path) {
        Ok(value) => value,
        Err(_) => return JavaConfig::default(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_java_config(base: &Path, config: &JavaConfig) -> Result<(), String> {
    let path = java_config_path(base);
    let payload = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
    fs::write(path, payload).map_err(|err| err.to_string())
}

fn load_app_settings(base: &Path) -> AppSettings {
    let path = app_settings_path(base);
    if !path.exists() {
        return AppSettings::default();
    }
    let content = match fs::read_to_string(&path) {
        Ok(value) => value,
        Err(_) => return AppSettings::default(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_app_settings(base: &Path, settings: &AppSettings) -> Result<(), String> {
    let path = app_settings_path(base);
    let payload = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    fs::write(path, payload).map_err(|err| err.to_string())
}

fn log_analytics_event(base: &Path, settings: &AppSettings, name: &str) {
    if !settings.analytics_enabled {
        return;
    }
    let path = analytics_path(base);
    let timestamp = Utc::now().to_rfc3339();
    let entry = serde_json::json!({
        "event": name,
        "timestamp": timestamp,
    });
    let mut list = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<Vec<serde_json::Value>>(&content).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    list.push(entry.clone());
    if let Ok(payload) = serde_json::to_string_pretty(&list) {
        let _ = fs::write(path, payload);
    }

    if let Some(endpoint) = settings.analytics_endpoint.as_deref() {
        if endpoint.starts_with("http") {
            let endpoint = endpoint.to_string();
            let entry = entry.clone();
            std::thread::spawn(move || {
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(2))
                    .build();
                if let Ok(client) = client {
                    let _ = client.post(endpoint).json(&entry).send();
                }
            });
        }
    }
}

fn registry_path(base: &Path) -> PathBuf {
    base.join("configs").join("servers.json")
}

fn legacy_config_path(base: &Path) -> PathBuf {
    base.join("configs").join("server.json")
}

fn server_meta_path(base: &Path, server_name: &str) -> PathBuf {
    base.join("configs").join(format!("{}_meta.json", sanitize_name(server_name)))
}

fn server_metadata_path(server_dir: &Path) -> PathBuf {
    server_dir.join("metadata.json")
}

fn backups_root(base: &Path, server_name: &str) -> PathBuf {
    base.join("backups").join(sanitize_name(server_name))
}

fn backup_manifest_path(base: &Path, server_name: &str) -> PathBuf {
    backups_root(base, server_name).join("manifest.json")
}

fn modpack_path(server_dir: &Path) -> PathBuf {
    server_dir.join("modpack.json")
}

fn server_loader_label(server_type: &ServerType) -> String {
    match server_type {
        ServerType::Forge => "forge",
        ServerType::Fabric => "fabric",
        _ => "none",
    }
    .to_string()
}

fn minecraft_dir() -> Result<PathBuf, String> {
    if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not set".to_string())?;
        return Ok(PathBuf::from(appdata).join(".minecraft"));
    }
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    Ok(PathBuf::from(home).join(".minecraft"))
}

fn client_version_installed(version: &str) -> bool {
    let Ok(root) = minecraft_dir() else { return false };
    let version_dir = root.join("versions").join(version);
    if !version_dir.exists() {
        return false;
    }
    version_dir.join(format!("{}.json", version)).exists()
        || version_dir.join(format!("{}.jar", version)).exists()
}

fn extract_mc_version(value: &str) -> Option<String> {
    let re = Regex::new(r"(\d+\.\d+(?:\.\d+)?)").ok()?;
    re.captures(value)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

fn parse_client_version_info(version_id: &str) -> Result<Option<ClientVersionInfo>, String> {
    if !client_version_installed(version_id) {
        return Ok(None);
    }
    let root = minecraft_dir()?;
    let version_path = root.join("versions").join(version_id).join(format!("{}.json", version_id));
    if !version_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(version_path).map_err(|err| err.to_string())?;
    let value = serde_json::from_str::<serde_json::Value>(&content).map_err(|err| err.to_string())?;

    let id = value
        .get("id")
        .and_then(|val| val.as_str())
        .unwrap_or(version_id)
        .to_string();
    let inherits_from = value
        .get("inheritsFrom")
        .and_then(|val| val.as_str())
        .map(|val| val.to_string());
    let mc_version = inherits_from
        .clone()
        .or_else(|| extract_mc_version(&id))
        .unwrap_or_else(|| id.clone());

    let mut loader = "vanilla".to_string();
    let id_lower = id.to_lowercase();
    if id_lower.contains("forge") || id_lower.contains("fml") {
        loader = "forge".to_string();
    } else if id_lower.contains("fabric") {
        loader = "fabric".to_string();
    } else if id_lower.contains("quilt") {
        loader = "quilt".to_string();
    } else if let Some(libraries) = value.get("libraries").and_then(|val| val.as_array()) {
        for library in libraries {
            let name = library.get("name").and_then(|val| val.as_str()).unwrap_or("");
            let lower = name.to_lowercase();
            if lower.contains("net.minecraftforge") || lower.contains("forge") {
                loader = "forge".to_string();
                break;
            }
            if lower.contains("net.fabricmc") || lower.contains("fabric") {
                loader = "fabric".to_string();
                break;
            }
            if lower.contains("org.quiltmc") || lower.contains("quilt") {
                loader = "quilt".to_string();
                break;
            }
        }
    }

    Ok(Some(ClientVersionInfo {
        version_id: id,
        mc_version,
        loader,
    }))
}

#[tauri::command]
fn get_client_version_info(version_id: String) -> Result<Option<ClientVersionInfo>, String> {
    parse_client_version_info(&version_id)
}

fn launcher_profiles_path() -> Result<PathBuf, String> {
    Ok(minecraft_dir()?.join("launcher_profiles.json"))
}

fn latest_log_path() -> Option<PathBuf> {
    let root = minecraft_dir().ok()?;
    Some(root.join("logs").join("latest.log"))
}

fn parse_latest_log() -> Option<(String, String)> {
    let path = latest_log_path()?;
    let content = fs::read_to_string(path).ok()?;
    let mut version: Option<String> = None;
    let mut loader = "vanilla".to_string();
    let version_re = Regex::new(r"Minecraft\s+(\d+\.\d+(?:\.\d+)?)").ok()?;
    for line in content.lines() {
        if version.is_none() {
            if let Some(caps) = version_re.captures(line) {
                if let Some(value) = caps.get(1) {
                    version = Some(value.as_str().to_string());
                }
            }
        }
        let lower = line.to_lowercase();
        if lower.contains("forge") || lower.contains("modlauncher") {
            loader = "forge".to_string();
        } else if lower.contains("fabric") {
            loader = "fabric".to_string();
        } else if lower.contains("quilt") {
            loader = "quilt".to_string();
        }
        if version.is_some() && loader != "vanilla" {
            break;
        }
    }
    version.map(|value| (value, loader))
}

#[cfg(target_os = "windows")]
const GAMEHOST_ICON_PNG: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../public/logo.png"));

fn ensure_launcher_profile(version: &str, server_name: Option<&str>) -> Result<String, String> {
    if !client_version_installed(version) {
        return Err("Client version is not installed".to_string());
    }
    let path = launcher_profiles_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let profile_name = server_name
        .map(|name| format!("GameHost ONE - {}", name))
        .unwrap_or_else(|| format!("GameHost ONE - {}", version));

    let mut root = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        serde_json::from_str::<serde_json::Value>(&content).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };

    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    if root.get("profiles").is_none() {
        root["profiles"] = json!({});
    }
    let profiles = root
        .get_mut("profiles")
        .and_then(|value| value.as_object_mut())
        .ok_or("Unable to access launcher profiles")?;

    let icon_data = format!("data:image/png;base64,{}", general_purpose::STANDARD.encode(GAMEHOST_ICON_PNG));
    let entry = profiles.entry(profile_name.clone()).or_insert_with(|| {
        json!({
            "name": profile_name,
            "type": "custom",
            "created": now,
            "lastUsed": now,
            "icon": icon_data,
            "lastVersionId": version
        })
    });

    if let Some(obj) = entry.as_object_mut() {
        obj.insert("lastVersionId".to_string(), json!(version));
        obj.insert("lastUsed".to_string(), json!(now));
        obj.insert("icon".to_string(), json!(icon_data));
    }

    root["selectedProfile"] = json!(profile_name.clone());
    let payload = serde_json::to_string_pretty(&root).map_err(|err| err.to_string())?;
    fs::write(path, payload).map_err(|err| err.to_string())?;
    Ok(profile_name)
}

fn client_mods_dir() -> Result<PathBuf, String> {
    Ok(minecraft_dir()?.join("mods"))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|err| err.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|err| err.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn is_allowed_mod_url(url: &str) -> Result<(), String> {
    ensure_https(url)?;
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid URL".to_string())?;
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    let allowed = ["cdn.modrinth.com", "edge.forgecdn.net", "mediafilez.forgecdn.net"];
    if allowed.iter().any(|item| host == *item) {
        Ok(())
    } else {
        Err("Only Modrinth or CurseForge CDN URLs are allowed".to_string())
    }
}

fn filename_from_url(url: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid URL".to_string())?;
    parsed
        .path_segments()
        .and_then(|segments| segments.last())
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string())
        .ok_or("Unable to read filename from URL".to_string())
}

fn parse_semver(value: &str) -> Option<(u32, u32, u32)> {
    let trimmed = value.trim_start_matches('v');
    let parts: Vec<&str> = trimmed.split('.').collect();
    if parts.len() < 3 {
        return None;
    }
    let major = parts[0].parse::<u32>().ok()?;
    let minor = parts[1].parse::<u32>().ok()?;
    let patch = parts[2].parse::<u32>().ok()?;
    Some((major, minor, patch))
}

fn is_newer_version(current: &str, latest: &str) -> bool {
    let Some(current) = parse_semver(current) else { return false };
    let Some(latest) = parse_semver(latest) else { return false };
    latest > current
}

fn log_path(base: &Path) -> PathBuf {
    base.join("logs").join("events.log")
}

fn settings_path(server_dir: &Path) -> PathBuf {
    server_dir.join("settings.toml")
}

fn sanitize_name(name: &str) -> String {
    let mut cleaned = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            cleaned.push(ch);
        } else if ch.is_whitespace() {
            cleaned.push('_');
        }
    }
    if cleaned.is_empty() {
        "minecraft_server".to_string()
    } else {
        cleaned
    }
}

fn save_registry(path: &Path, registry: &ServerRegistry) -> Result<(), String> {
    let content = serde_json::to_string_pretty(registry).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| err.to_string())
}

fn load_legacy_config(path: &Path) -> Result<ServerConfig, String> {
    let content = fs::read_to_string(path).map_err(|_| "Server not configured")?;
    serde_json::from_str(&content).map_err(|err| err.to_string())
}

fn load_registry(path: &Path, legacy_path: &Path) -> Result<ServerRegistry, String> {
    if path.exists() {
        let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
        let registry: ServerRegistry = serde_json::from_str(&content).map_err(|err| err.to_string())?;
        return Ok(registry);
    }

    if legacy_path.exists() {
        let legacy = load_legacy_config(legacy_path)?;
        let registry = ServerRegistry {
            servers: vec![legacy],
        };
        save_registry(path, &registry)?;
        return Ok(registry);
    }

    Ok(ServerRegistry::default())
}

fn load_server_meta(base: &Path, server_name: &str) -> Result<ServerMeta, String> {
    let path = server_meta_path(base, server_name);
    if !path.exists() {
        return Ok(ServerMeta::default());
    }
    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    serde_json::from_str(&content).map_err(|err| err.to_string())
}

fn save_server_meta(base: &Path, server_name: &str, meta: &ServerMeta) -> Result<(), String> {
    let path = server_meta_path(base, server_name);
    let content = serde_json::to_string_pretty(meta).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| err.to_string())
}

fn load_server_metadata(server_dir: &Path) -> Option<ServerMetadata> {
    let path = server_metadata_path(server_dir);
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_server_metadata(server_dir: &Path, metadata: &ServerMetadata) -> Result<(), String> {
    let path = server_metadata_path(server_dir);
    let content = serde_json::to_string_pretty(metadata).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| err.to_string())
}

fn load_modpack(server_dir: &Path, config: &ServerConfig) -> Result<ModpackManifest, String> {
    let path = modpack_path(server_dir);
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        let mut manifest: ModpackManifest = serde_json::from_str(&content).unwrap_or(ModpackManifest {
            mc_version: config.version.clone(),
            loader: server_loader_label(&config.server_type),
            mods: Vec::new(),
        });
        manifest.mc_version = config.version.clone();
        manifest.loader = server_loader_label(&config.server_type);
        if manifest.mods.is_empty() {
            if let Some(fallback) = build_modpack_from_server_mods(server_dir, config)? {
                save_modpack(server_dir, &fallback)?;
                return Ok(fallback);
            }
        }
        return Ok(manifest);
    }

    if let Some(fallback) = build_modpack_from_server_mods(server_dir, config)? {
        save_modpack(server_dir, &fallback)?;
        return Ok(fallback);
    }

    Ok(ModpackManifest {
        mc_version: config.version.clone(),
        loader: server_loader_label(&config.server_type),
        mods: Vec::new(),
    })
}

fn save_modpack(server_dir: &Path, manifest: &ModpackManifest) -> Result<(), String> {
    let path = modpack_path(server_dir);
    let content = serde_json::to_string_pretty(manifest).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| err.to_string())
}

fn build_modpack_from_server_mods(
    server_dir: &Path,
    config: &ServerConfig,
) -> Result<Option<ModpackManifest>, String> {
    let mods_dir = server_dir.join("mods");
    if !mods_dir.exists() {
        return Ok(None);
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&mods_dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jar") {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("mod");
        let id = file_name.trim_end_matches(".jar").to_string();
        let sha256 = sha256_file(&path)?;
        entries.push(ModpackEntry {
            id,
            version: "unknown".to_string(),
            sha256,
            url: String::new(),
        });
    }

    if entries.is_empty() {
        return Ok(None);
    }

    Ok(Some(ModpackManifest {
        mc_version: config.version.clone(),
        loader: server_loader_label(&config.server_type),
        mods: entries,
    }))
}

fn load_backup_manifest(base: &Path, server_name: &str) -> Result<Vec<BackupEntry>, String> {
    let path = backup_manifest_path(base, server_name);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    serde_json::from_str(&content).map_err(|err| err.to_string())
}

fn save_backup_manifest(base: &Path, server_name: &str, entries: &[BackupEntry]) -> Result<(), String> {
    let path = backup_manifest_path(base, server_name);
    let content = serde_json::to_string_pretty(entries).map_err(|err| err.to_string())?;
    fs::create_dir_all(path.parent().unwrap_or(base)).map_err(|err| err.to_string())?;
    fs::write(path, content).map_err(|err| err.to_string())
}

fn append_log(base: &Path, message: &str) {
    let path = log_path(base);
    let timestamp = Utc::now().to_rfc3339();
    if let Ok(mut file) = File::options().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{}] {}", timestamp, message);
    }
}

fn write_crash_report(base: &Path, settings: &AppSettings, app_version: &str, message: &str) {
    if !settings.crash_reporting_enabled {
        return;
    }
    let timestamp = Utc::now().to_rfc3339();
    let backtrace = format!("{:?}", std::backtrace::Backtrace::capture());
    let report = CrashReport {
        timestamp: timestamp.clone(),
        app_version: app_version.to_string(),
        os: std::env::consts::OS.to_string(),
        message: message.to_string(),
        backtrace,
    };

    let dir = crashes_dir(base);
    let _ = fs::create_dir_all(&dir);
    let file_name = format!("crash_{}.json", timestamp.replace(':', "-"));
    let path = dir.join(file_name);
    if let Ok(payload) = serde_json::to_string_pretty(&report) {
        let _ = fs::write(path, payload);
    }

    log_analytics_event(base, settings, "crash_occurred");
}

fn server_matches_id(server: &ServerConfig, server_id: &str) -> bool {
    server.name == server_id || sanitize_name(&server.name) == sanitize_name(server_id)
}

fn get_server_by_id(registry: &ServerRegistry, server_id: &str) -> Option<ServerConfig> {
    registry
        .servers
        .iter()
        .find(|server| server_matches_id(server, server_id))
        .cloned()
}

fn get_preferred_server_id(state: &AppState) -> Option<String> {
    if let Ok(manager) = state.process.lock() {
        if let Some(active) = manager.active_server_id.clone() {
            return Some(active);
        }
    }

    if let Ok(registry) = load_registry(&state.registry_path, &state.legacy_config_path) {
        return registry.servers.first().map(|server| server.name.clone());
    }

    None
}

fn resolve_server_dir(state: &AppState, server_id: &str) -> Result<PathBuf, String> {
    let sanitized = sanitize_name(server_id);
    let candidate = state.data_dir.join("servers").join(&sanitized);
    if candidate.exists() {
        return Ok(candidate);
    }

    if let Ok(registry) = load_registry(&state.registry_path, &state.legacy_config_path) {
        if let Some(config) = get_server_by_id(&registry, server_id) {
            return Ok(PathBuf::from(config.server_dir));
        }
    }

    Err("Server not found".to_string())
}

fn find_server_jar(server_dir: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(entries) = fs::read_dir(server_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("jar") {
                candidates.push(path);
            }
        }
    }

    if let Some(match_path) = candidates.iter().find(|path| {
        path.file_name()
            .and_then(|s| s.to_str())
            .map(|name| name.contains("fabric-server-launch"))
            .unwrap_or(false)
    }) {
        return Some(match_path.clone());
    }

    if let Some(match_path) = candidates.iter().find(|path| {
        path.file_name()
            .and_then(|s| s.to_str())
            .map(|name| name.contains("forge") || name.contains("paper"))
            .unwrap_or(false)
    }) {
        return Some(match_path.clone());
    }

    candidates.into_iter().next()
}

fn detect_server_type(server_dir: &Path, jar_path: &Path) -> ServerType {
    let jar_name = jar_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    if jar_name.contains("fabric") {
        return ServerType::Fabric;
    }
    if jar_name.contains("forge") {
        return ServerType::Forge;
    }
    if jar_name.contains("paper") {
        return ServerType::Paper;
    }

    if server_dir.join("libraries").join("net").join("minecraftforge").exists() {
        return ServerType::Forge;
    }

    ServerType::Vanilla
}

fn list_root_jars(server_dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(server_dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.extension().and_then(|s| s.to_str()) == Some("jar"))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn detect_loader(server_dir: &Path) -> String {
    let jars = list_root_jars(server_dir);
    let has_quilt_jar = jars.iter().any(|path| {
        path.file_name()
            .and_then(|s| s.to_str())
            .map(|name| name.to_lowercase().starts_with("quilt-server-launch"))
            .unwrap_or(false)
    });
    let has_fabric_jar = jars.iter().any(|path| {
        path.file_name()
            .and_then(|s| s.to_str())
            .map(|name| name.to_lowercase().starts_with("fabric-server-launch"))
            .unwrap_or(false)
    });
    let has_forge_jar = jars.iter().any(|path| {
        path.file_name()
            .and_then(|s| s.to_str())
            .map(|name| name.to_lowercase().starts_with("forge-") || name.to_lowercase().contains("forge"))
            .unwrap_or(false)
    });
    let has_vanilla_jar = jars.iter().any(|path| {
        path.file_name()
            .and_then(|s| s.to_str())
            .map(|name| name.to_lowercase().starts_with("minecraft_server"))
            .unwrap_or(false)
    });

    let libraries = server_dir.join("libraries");
    let has_quilt_lib = libraries.join("org").join("quiltmc").exists();
    let has_fabric_lib = libraries.join("net").join("fabricmc").exists()
        || libraries.join("net").join("fabric-loader").exists();
    let has_forge_lib = libraries.join("net").join("minecraftforge").exists();

    if has_quilt_jar || has_quilt_lib {
        return "quilt".to_string();
    }
    if has_fabric_jar || has_fabric_lib {
        return "fabric".to_string();
    }
    if has_forge_jar || has_forge_lib {
        return "forge".to_string();
    }
    if has_vanilla_jar {
        return "vanilla".to_string();
    }
    "unknown".to_string()
}

fn guess_version_from_name(name: &str) -> Option<String> {
    let re = Regex::new(r"(\d+\.\d+(?:\.\d+)?)").ok()?;
    let caps = re.captures(name)?;
    caps.get(1).map(|m| m.as_str().to_string())
}

fn read_version_from_json(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    if let Some(id) = value.get("id").and_then(|v| v.as_str()) {
        return Some(id.to_string());
    }
    if let Some(id) = value.get("name").and_then(|v| v.as_str()) {
        return Some(id.to_string());
    }
    if let Some(id) = value.get("minecraft").and_then(|v| v.as_str()) {
        return Some(id.to_string());
    }
    if let Some(info) = value.get("versionInfo") {
        if let Some(id) = info.get("minecraftVersion").and_then(|v| v.as_str()) {
            return Some(id.to_string());
        }
        if let Some(id) = info.get("id").and_then(|v| v.as_str()) {
            return Some(id.to_string());
        }
    }
    None
}

fn detect_version_from_json(server_dir: &Path) -> Option<String> {
    let direct = server_dir.join("version.json");
    if direct.exists() {
        if let Some(version) = read_version_from_json(&direct) {
            return Some(version);
        }
    }

    let versions_dir = server_dir.join("versions");
    if versions_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&versions_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let json_path = path.join("version.json");
                    if json_path.exists() {
                        if let Some(version) = read_version_from_json(&json_path) {
                            return Some(version);
                        }
                    }
                } else if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Some(version) = read_version_from_json(&path) {
                        return Some(version);
                    }
                }
            }
        }
    }
    None
}

fn detect_version_from_install_profile(server_dir: &Path) -> Option<String> {
    let profile = server_dir.join("install_profile.json");
    if profile.exists() {
        if let Some(version) = read_version_from_json(&profile) {
            return Some(version);
        }
    }
    None
}

fn detect_version_from_level_dat(server_dir: &Path) -> Option<String> {
    let world_dir = server_dir.join("world");
    if !world_dir.exists() {
        return None;
    }
    let (version, _) = read_level_dat(&world_dir).unwrap_or((None, false));
    version
}

fn detect_server_version(server_dir: &Path) -> Option<String> {
    let jars = list_root_jars(server_dir);
    for jar in &jars {
        if let Some(name) = jar.file_name().and_then(|s| s.to_str()) {
            if let Some(version) = guess_version_from_name(name) {
                return Some(version);
            }
        }
    }
    detect_version_from_json(server_dir)
        .or_else(|| detect_version_from_install_profile(server_dir))
        .or_else(|| detect_version_from_level_dat(server_dir))
}

fn detect_mod_count(server_dir: &Path) -> usize {
    let mods_dir = server_dir.join("mods");
    if !mods_dir.exists() {
        return 0;
    }
    count_mods(&mods_dir)
}

fn detect_modded_world(server_dir: &Path) -> bool {
    let world_dir = server_dir.join("world");
    if !world_dir.exists() {
        return false;
    }
    let (_, detected_type) = detect_world_metadata(&world_dir);
    detected_type.is_some()
}

fn scan_server_metadata(server_dir: &Path) -> Result<ServerMetadata, String> {
    let loader = detect_loader(server_dir);
    let mc_version = detect_server_version(server_dir).unwrap_or_else(|| "unknown".to_string());
    let mod_count = detect_mod_count(server_dir);
    let modded_world = detect_modded_world(server_dir);
    let modpack = detect_modpack_type(server_dir);
    let detected_at = Utc::now().to_rfc3339();

    Ok(ServerMetadata {
        loader,
        mc_version,
        mod_count,
        modded_world,
        modpack,
        detected_at,
    })
}

fn parse_ram_from_args(text: &str) -> Option<u8> {
    let re = Regex::new(r"-Xmx(\d+)([GgMm])").ok()?;
    let caps = re.captures(text)?;
    let amount: u32 = caps.get(1)?.as_str().parse().ok()?;
    let unit = caps.get(2)?.as_str();
    let gb = if unit.eq_ignore_ascii_case("g") {
        amount
    } else {
        (amount + 1023) / 1024
    };
    u8::try_from(gb).ok()
}

fn detect_ram_from_dir(server_dir: &Path) -> Option<u8> {
    let args_path = server_dir.join("user_jvm_args.txt");
    if let Ok(content) = fs::read_to_string(&args_path) {
        if let Some(value) = parse_ram_from_args(&content) {
            return Some(value);
        }
    }

    for entry in fs::read_dir(server_dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("bat") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Some(value) = parse_ram_from_args(&content) {
                    return Some(value);
                }
            }
        }
    }
    None
}

fn find_forge_args_file(server_dir: &Path) -> Option<String> {
    for entry in WalkDir::new(server_dir).into_iter().flatten() {
        let path = entry.path();
        if path.is_file() {
            let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if name == "win_args.txt" || name == "unix_args.txt" || name.ends_with("_args.txt") {
                if let Ok(relative) = path.strip_prefix(server_dir) {
                    return Some(relative.to_string_lossy().to_string());
                }
                return Some(path.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn read_port_and_online_mode(server_dir: &Path) -> (u16, bool) {
    let mut port = 25565;
    let mut online_mode = true;
    if let Ok(props) = read_server_properties(server_dir) {
        if let Some(value) = props.get("server-port") {
            if let Ok(parsed) = value.parse::<u16>() {
                port = parsed;
            }
        }
        if let Some(value) = props.get("online-mode") {
            online_mode = value.eq_ignore_ascii_case("true");
        }
    }
    (port, online_mode)
}

fn parse_java_major(text: &str) -> Option<u32> {
    let re = Regex::new(r#"version\s+\"(\d+)(?:\.(\d+))?"#).ok()?;
    let caps = re.captures(text)?;
    let first: u32 = caps.get(1)?.as_str().parse().ok()?;
    if first == 1 {
        let second: u32 = caps.get(2)?.as_str().parse().ok()?;
        return Some(second);
    }
    Some(first)
}

fn java_major_from_path(path: &Path) -> Result<u32, String> {
    let output = Command::new(path)
        .arg("-version")
        .output()
        .map_err(|err| err.to_string())?;
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let text = if stderr.trim().is_empty() { stdout } else { stderr };
    parse_java_major(&text).ok_or("Unable to parse Java version".to_string())
}

fn find_system_java_path() -> Option<PathBuf> {
    let output = if cfg!(target_os = "windows") {
        Command::new("where").arg("java").output().ok()?
    } else {
        Command::new("which").arg("java").output().ok()?
    };
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .next()
        .map(|line| PathBuf::from(line.trim()))
        .filter(|path| path.exists())
}

fn resolve_selected_java_path(base: &Path, config: &JavaConfig) -> Option<PathBuf> {
    if let Some(path) = &config.java_path {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    let runtime = runtime_java_exe(base);
    if runtime.exists() {
        return Some(runtime);
    }
    None
}

fn required_java_major(server_version: &str) -> u32 {
    let raw = server_version.split('-').next().unwrap_or(server_version);
    let parts: Vec<&str> = raw.split('.').collect();
    let major = parts.get(0).and_then(|value| value.parse::<u32>().ok()).unwrap_or(1);
    let minor = parts.get(1).and_then(|value| value.parse::<u32>().ok()).unwrap_or(0);
    let patch = parts.get(2).and_then(|value| value.parse::<u32>().ok()).unwrap_or(0);

    if major == 1 {
        if minor <= 16 {
            return 8;
        }
        if minor == 17 {
            return 16;
        }
        if minor == 20 && patch >= 5 {
            return 21;
        }
        return 17;
    }

    if major >= 21 {
        return 21;
    }
    if major >= 17 {
        return 17;
    }
    if major == 16 {
        return 16;
    }
    if major <= 15 {
        return 8;
    }
    17
}

fn build_java_status(required_major: u32, base: &Path, config: &JavaConfig) -> JavaStatusResult {
    let selected_path = resolve_selected_java_path(base, config);
    let selected_major = selected_path
        .as_ref()
        .and_then(|path| java_major_from_path(path).ok());

    let system_path = find_system_java_path();
    let system_major = system_path
        .as_ref()
        .and_then(|path| java_major_from_path(path).ok());

    let runtime_path = runtime_java_exe(base);
    let runtime_major = if runtime_path.exists() {
        java_major_from_path(&runtime_path).ok()
    } else {
        None
    };

    let status = match selected_major {
        None => "missing",
        Some(major) if major < required_major => "unsupported",
        Some(_) => "ready",
    };

    JavaStatusResult {
        status: status.to_string(),
        required_major,
        selected_path: selected_path.map(|path| path.to_string_lossy().to_string()),
        selected_major,
        system_path: system_path.map(|path| path.to_string_lossy().to_string()),
        system_major,
        runtime_path: if runtime_path.exists() {
            Some(runtime_path.to_string_lossy().to_string())
        } else {
            None
        },
        runtime_major,
    }
}

fn java_executable_for_version(server_version: &str, base: &Path) -> Result<PathBuf, String> {
    let required = required_java_major(server_version);
    let config = load_java_config(base);
    let selected = resolve_selected_java_path(base, &config)
        .ok_or("Java is required to run this server.".to_string())?;
    let major = java_major_from_path(&selected)?;
    if major < required {
        return Err(format!("Java {} is required for this server.", required));
    }
    Ok(selected)
}

fn get_java_major_version() -> Result<u32, String> {
    let output = Command::new("java")
        .arg("-version")
        .output()
        .map_err(|_| "Java is not installed".to_string())?;
    let text = String::from_utf8_lossy(&output.stderr).to_string();
    parse_java_major(&text).ok_or("Unable to parse Java version".to_string())
}

fn analyze_server_folder(path: &Path) -> Result<ImportAnalysis, String> {
    if !path.exists() || !path.is_dir() {
        return Err("Server folder not found".to_string());
    }

    let jar_path = find_server_jar(path).ok_or("No server jar found")?;
    let server_type = detect_server_type(path, &jar_path);
    let detected_version = detect_server_version(path).unwrap_or_else(|| "unknown".to_string());

    let has_properties = path.join("server.properties").exists();
    let has_world = path.join("world").exists();
    let has_nether = path.join("world_nether").exists();
    let has_end = path.join("world_the_end").exists();
    let detected_ram_gb = detect_ram_from_dir(path);

    let mut warnings = Vec::new();
    match get_java_major_version() {
        Ok(version) => {
            if version < 17 {
                warnings.push("Java 17+ is recommended for modern Minecraft servers.".to_string());
            }
        }
        Err(err) => warnings.push(err),
    }

    let system_ram_gb = System::new_all().total_memory() as u64 / 1024 / 1024;
    if let Some(ram) = detected_ram_gb {
        if system_ram_gb > 0 && ram as u64 >= system_ram_gb {
            warnings.push("Configured RAM exceeds available system memory.".to_string());
        }
    }

    let suggested_name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Imported Server")
        .to_string();

    let jar_string = jar_path.to_string_lossy().to_string();

    Ok(ImportAnalysis {
        suggested_name,
        server_type,
        detected_version,
        jar_path: jar_string,
        has_properties,
        has_world,
        has_nether,
        has_end,
        detected_ram_gb,
        warnings,
    })
}

#[derive(Debug)]
struct WorldValidationDetails {
    world_root: PathBuf,
    has_playerdata: bool,
    has_data: bool,
    has_dim_nether: bool,
    has_dim_end: bool,
    detected_version: Option<String>,
    detected_type: Option<String>,
}

#[derive(Debug)]
struct PreparedWorldSource {
    world_root: PathBuf,
    staged_root: Option<PathBuf>,
    size_bytes: u64,
    detected_version: Option<String>,
    detected_type: Option<String>,
    has_playerdata: bool,
    has_data: bool,
    has_dim_nether: bool,
    has_dim_end: bool,
}

#[derive(Debug, Deserialize)]
struct LevelDat {
    #[serde(rename = "Data")]
    data: LevelDatData,
}

#[derive(Debug, Deserialize)]
struct LevelDatData {
    #[serde(rename = "Version")]
    version: Option<LevelDatVersion>,
    #[serde(rename = "Modded")]
    modded: Option<bool>,
    #[serde(rename = "WasModded")]
    was_modded: Option<bool>,
    #[serde(rename = "wasModded")]
    was_modded_legacy: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct LevelDatVersion {
    #[serde(rename = "Name")]
    name: Option<String>,
}

fn is_valid_world_dir(path: &Path) -> bool {
    path.join("level.dat").is_file() && path.join("region").is_dir()
}

fn find_world_root(path: &Path) -> Option<PathBuf> {
    if is_valid_world_dir(path) {
        return Some(path.to_path_buf());
    }

    let mut candidates = Vec::new();
    for entry in fs::read_dir(path).ok()?.flatten() {
        let child = entry.path();
        if child.is_dir() {
            candidates.push(child);
        }
    }
    if candidates.len() == 1 && is_valid_world_dir(&candidates[0]) {
        return Some(candidates.remove(0));
    }

    None
}

fn compute_dir_size(path: &Path) -> Result<u64, String> {
    let mut total = 0u64;
    for entry in WalkDir::new(path).into_iter().flatten() {
        let entry_path = entry.path();
        if entry_path.is_file() {
            total += entry_path.metadata().map_err(|err| err.to_string())?.len();
        }
    }
    Ok(total)
}

fn read_level_dat(world_root: &Path) -> Option<(Option<String>, bool)> {
    let path = world_root.join("level.dat");
    let file = File::open(&path).ok()?;
    let mut decoder = flate2::read::GzDecoder::new(file);
    let mut bytes = Vec::new();
    decoder.read_to_end(&mut bytes).ok()?;
    let level: LevelDat = from_bytes(&bytes).ok()?;

    let detected_version = level
        .data
        .version
        .and_then(|version| version.name)
        .filter(|value| !value.trim().is_empty());
    let modded = level.data.modded.unwrap_or(false)
        || level.data.was_modded.unwrap_or(false)
        || level.data.was_modded_legacy.unwrap_or(false);
    Some((detected_version, modded))
}

fn detect_world_metadata(world_root: &Path) -> (Option<String>, Option<String>) {
    let (level_version, level_modded) = read_level_dat(world_root).unwrap_or((None, false));
    let has_forge_data = world_root.join("data").join("forge").exists()
        || world_root.join("data").join("fml").exists();

    let detected_type = if level_modded || has_forge_data {
        Some("forge".to_string())
    } else if level_version.is_some() {
        Some("vanilla".to_string())
    } else {
        None
    };

    (level_version, detected_type)
}

fn validate_world_dir(path: &Path) -> Result<WorldValidationDetails, String> {
    let root = find_world_root(path)
        .ok_or_else(|| "Selected folder does not appear to be a valid Minecraft world.".to_string())?;
    if !is_valid_world_dir(&root) {
        return Err("Selected folder does not appear to be a valid Minecraft world.".to_string());
    }

    let has_playerdata = root.join("playerdata").is_dir();
    let has_data = root.join("data").is_dir();
    let has_dim_nether = root.join("DIM-1").is_dir();
    let has_dim_end = root.join("DIM1").is_dir();
    let (detected_version, detected_type) = detect_world_metadata(&root);

    Ok(WorldValidationDetails {
        world_root: root,
        has_playerdata,
        has_data,
        has_dim_nether,
        has_dim_end,
        detected_version,
        detected_type,
    })
}

fn safe_extract_zip(zip_path: &Path, target_dir: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|err| err.to_string())?;
    let mut archive =
        ZipArchive::new(file).map_err(|_| "Selected zip file is corrupted or unsupported".to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|err| err.to_string())?;
        let enclosed = match file.enclosed_name() {
            Some(name) => name.to_owned(),
            None => continue,
        };
        let outpath = target_dir.join(enclosed);
        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|err| err.to_string())?;
            continue;
        }
        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let mut outfile = File::create(&outpath).map_err(|err| err.to_string())?;
        std::io::copy(&mut file, &mut outfile).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn stage_world_zip(zip_path: &Path, base: &Path) -> Result<PathBuf, String> {
    if !zip_path.exists() {
        return Err("Zip file not found".to_string());
    }
    if zip_path.extension().and_then(|ext| ext.to_str()) != Some("zip") {
        return Err("Only .zip worlds are supported".to_string());
    }
    let temp_root = base
        .join("temp")
        .join("world-import")
        .join(format!("{}", Utc::now().timestamp_millis()));
    fs::create_dir_all(&temp_root).map_err(|err| err.to_string())?;
    safe_extract_zip(zip_path, &temp_root)?;
    Ok(temp_root)
}

fn stage_mods_zip(zip_path: &Path, base: &Path) -> Result<PathBuf, String> {
    if !zip_path.exists() {
        return Err("Zip file not found".to_string());
    }
    if zip_path.extension().and_then(|ext| ext.to_str()) != Some("zip") {
        return Err("Only .zip modpacks are supported".to_string());
    }
    let temp_root = base
        .join("temp")
        .join("mod-import")
        .join(format!("{}", Utc::now().timestamp_millis()));
    fs::create_dir_all(&temp_root).map_err(|err| err.to_string())?;
    safe_extract_zip(zip_path, &temp_root)?;
    Ok(temp_root)
}

fn find_mods_root(path: &Path) -> Option<PathBuf> {
    let candidates = [
        path.join("overrides").join("mods"),
        path.join("mods"),
        path.join("minecraft").join("mods"),
    ];
    for candidate in candidates {
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    if path.is_dir() {
        let has_jar = fs::read_dir(path)
            .ok()?
            .flatten()
            .any(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("jar"));
        if has_jar {
            return Some(path.to_path_buf());
        }
    }

    None
}

fn count_mods(mods_root: &Path) -> usize {
    fs::read_dir(mods_root)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("jar"))
                .count()
        })
        .unwrap_or(0)
}

fn detect_modpack_type(root: &Path) -> Option<String> {
    if root.join("modrinth.index.json").exists() {
        return Some("modrinth".to_string());
    }
    if root.join("manifest.json").exists() {
        return Some("curseforge".to_string());
    }
    None
}

fn normalize_loader_label(value: &str) -> String {
    let lower = value.to_lowercase();
    if lower.contains("fabric") {
        return "fabric".to_string();
    }
    if lower.contains("forge") || lower.contains("fml") {
        return "forge".to_string();
    }
    "none".to_string()
}

fn parse_curseforge_manifest(root: &Path) -> Result<Option<ModpackManifest>, String> {
    let path = root.join("manifest.json");
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    let manifest: CurseForgeManifest = serde_json::from_str(&content).map_err(|err| err.to_string())?;
    let loader = manifest
        .minecraft
        .mod_loaders
        .iter()
        .find(|loader| loader.primary)
        .map(|loader| loader.id.as_str())
        .or_else(|| manifest.minecraft.mod_loaders.first().map(|loader| loader.id.as_str()))
        .map(normalize_loader_label)
        .unwrap_or_else(|| "none".to_string());

    let mods = manifest
        .files
        .into_iter()
        .map(|entry| ModpackEntry {
            id: entry.project_id.to_string(),
            version: entry.file_id.to_string(),
            sha256: String::new(),
            url: String::new(),
        })
        .collect::<Vec<_>>();

    Ok(Some(ModpackManifest {
        mc_version: manifest.minecraft.version,
        loader,
        mods,
    }))
}

fn parse_modrinth_index(root: &Path) -> Result<Option<ModpackManifest>, String> {
    let path = root.join("modrinth.index.json");
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    let manifest: ModrinthIndex = serde_json::from_str(&content).map_err(|err| err.to_string())?;
    let mc_version = manifest
        .dependencies
        .get("minecraft")
        .cloned()
        .unwrap_or_else(|| "unknown".to_string());
    let loader = if manifest.dependencies.contains_key("forge") {
        "forge".to_string()
    } else if manifest.dependencies.contains_key("fabric-loader") || manifest.dependencies.contains_key("fabric") {
        "fabric".to_string()
    } else {
        "none".to_string()
    };

    let mods = manifest
        .files
        .into_iter()
        .map(|entry| {
            let name = Path::new(&entry.path)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("mod")
                .to_string();
            let sha256 = entry
                .hashes
                .get("sha256")
                .cloned()
                .unwrap_or_default();
            let url = entry.downloads.first().cloned().unwrap_or_default();
            ModpackEntry {
                id: name,
                version: "unknown".to_string(),
                sha256,
                url,
            }
        })
        .collect::<Vec<_>>();

    Ok(Some(ModpackManifest {
        mc_version,
        loader,
        mods,
    }))
}

fn build_modpack_from_source(root: &Path) -> Result<Option<ModpackManifest>, String> {
    if let Some(modrinth) = parse_modrinth_index(root)? {
        return Ok(Some(modrinth));
    }
    if let Some(curseforge) = parse_curseforge_manifest(root)? {
        return Ok(Some(curseforge));
    }
    Ok(None)
}

fn prepare_mods_source(input: &ModsImportInput, base: &Path) -> Result<(PathBuf, Option<PathBuf>), String> {
    let kind = input.source_kind.trim().to_lowercase();
    if kind != "zip" && kind != "folder" {
        return Err("Invalid mods source type".to_string());
    }

    let mut staged_root = None;
    let source_root = if kind == "zip" {
        if let Some(staged) = &input.staged_path {
            let path = PathBuf::from(staged);
            if !path.exists() {
                return Err("Staged modpack folder not found".to_string());
            }
            staged_root = Some(path.clone());
            path
        } else {
            let staged = stage_mods_zip(Path::new(&input.source_path), base)?;
            staged_root = Some(staged.clone());
            staged
        }
    } else {
        let path = PathBuf::from(&input.source_path);
        if !path.exists() || !path.is_dir() {
            return Err("Mods folder not found".to_string());
        }
        path
    };

    Ok((source_root, staged_root))
}

#[tauri::command]
fn validate_mods_source(
    source_path: String,
    source_kind: String,
    state: State<AppState>,
) -> Result<ModsValidationResult, String> {
    let input = ModsImportInput {
        source_path,
        source_kind: source_kind.clone(),
        staged_path: None,
    };

    let (source_root, staged_root) = prepare_mods_source(&input, &state.data_dir)?;
    let mods_root = find_mods_root(&source_root)
        .ok_or_else(|| "No .jar mods found in the selected source.".to_string())?;
    let mod_count = count_mods(&mods_root);
    if mod_count == 0 {
        return Err("No .jar mods found in the selected source.".to_string());
    }

    Ok(ModsValidationResult {
        valid: true,
        source_kind,
        mods_path: mods_root.to_string_lossy().to_string(),
        staged_path: staged_root.map(|value| value.to_string_lossy().to_string()),
        mod_count,
        detected_pack: detect_modpack_type(&source_root),
    })
}

fn import_mods_into_server(
    server_dir: &Path,
    input: &ModsImportInput,
    state: &AppState,
) -> Result<(), String> {
    let (source_root, staged_root) = prepare_mods_source(input, &state.data_dir)?;
    let mods_root = find_mods_root(&source_root)
        .ok_or_else(|| "No .jar mods found in the selected source.".to_string())?;

    let target_mods = server_dir.join("mods");
    fs::create_dir_all(&target_mods).map_err(|err| err.to_string())?;

    for entry in fs::read_dir(&mods_root).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jar") {
            continue;
        }
        let file_name = entry.file_name();
        let destination = target_mods.join(&file_name);
        if destination.exists() {
            return Err(format!(
                "Mod already exists in target folder: {}",
                file_name.to_string_lossy()
            ));
        }
        fs::copy(&path, &destination).map_err(|err| err.to_string())?;
    }

    if let Some(manifest) = build_modpack_from_source(&source_root)? {
        let _ = save_modpack(server_dir, &manifest);
    }

    if let Some(staged_root) = staged_root {
        let temp_root = state.data_dir.join("temp").join("mod-import");
        if staged_root.starts_with(&temp_root) {
            let _ = fs::remove_dir_all(staged_root);
        }
    }

    Ok(())
}

fn copy_dir_with_progress(
    source: &Path,
    destination: &Path,
    app: &AppHandle,
    server_name: &str,
    total_bytes: u64,
) -> Result<(), String> {
    if !destination.exists() {
        fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    }

    let mut copied = 0u64;
    let mut last_emit = Instant::now();

    for entry in WalkDir::new(source) {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let relative = path.strip_prefix(source).map_err(|err| err.to_string())?;
        let target = destination.join(relative);
        if path.is_dir() {
            fs::create_dir_all(&target).map_err(|err| err.to_string())?;
            continue;
        }

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }

        let mut input = File::open(path).map_err(|err| err.to_string())?;
        let mut output = File::create(&target).map_err(|err| err.to_string())?;
        let mut buffer = vec![0u8; 8 * 1024 * 1024];
        loop {
            let read = input.read(&mut buffer).map_err(|err| err.to_string())?;
            if read == 0 {
                break;
            }
            output.write_all(&buffer[..read]).map_err(|err| err.to_string())?;
            copied = copied.saturating_add(read as u64);

            if total_bytes > 0 && last_emit.elapsed() >= Duration::from_millis(250) {
                let percent = ((copied as f64 / total_bytes as f64) * 100.0).round() as u8;
                let payload = WorldCopyProgress {
                    server_name: server_name.to_string(),
                    total_bytes,
                    copied_bytes: copied,
                    percent: percent.min(100),
                };
                let _ = app.emit("world:copy", payload);
                last_emit = Instant::now();
            }
        }
    }

    let percent = if total_bytes == 0 { 100 } else { 100 };
    let payload = WorldCopyProgress {
        server_name: server_name.to_string(),
        total_bytes,
        copied_bytes: total_bytes.max(copied),
        percent,
    };
    let _ = app.emit("world:copy", payload);
    Ok(())
}

fn set_level_name(server_dir: &Path, level_name: &str) -> Result<(), String> {
    let path = server_dir.join("server.properties");
    let content = fs::read_to_string(&path).unwrap_or_default();
    let mut lines = Vec::new();
    let mut updated = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with('!') || !trimmed.contains('=') {
            lines.push(line.to_string());
            continue;
        }
        let mut parts = trimmed.splitn(2, '=');
        let key = parts.next().unwrap_or("").trim();
        if key == "level-name" {
            lines.push(format!("level-name={}", level_name));
            updated = true;
        } else {
            lines.push(line.to_string());
        }
    }

    if !updated {
        lines.push(format!("level-name={}", level_name));
    }

    fs::write(path, format!("{}\n", lines.join("\n"))).map_err(|err| err.to_string())
}

fn prepare_world_source(input: &WorldImportInput, base: &Path) -> Result<PreparedWorldSource, String> {
    let kind = input.source_kind.trim().to_lowercase();
    if kind != "zip" && kind != "folder" {
        return Err("Invalid world source type".to_string());
    }
    let mut staged_root = None;

    let source_root = if kind == "zip" {
        if let Some(staged) = &input.staged_path {
            let path = PathBuf::from(staged);
            if !path.exists() {
                return Err("Staged world folder not found".to_string());
            }
            staged_root = Some(path.clone());
            path
        } else {
            let staged = stage_world_zip(Path::new(&input.source_path), base)?;
            staged_root = Some(staged.clone());
            staged
        }
    } else {
        let path = PathBuf::from(&input.source_path);
        if !path.exists() || !path.is_dir() {
            return Err("World folder not found".to_string());
        }
        path
    };

    let details = validate_world_dir(&source_root)?;
    let size_bytes = compute_dir_size(&details.world_root)?;

    Ok(PreparedWorldSource {
        world_root: details.world_root,
        staged_root,
        size_bytes,
        detected_version: details.detected_version,
        detected_type: details.detected_type,
        has_playerdata: details.has_playerdata,
        has_data: details.has_data,
        has_dim_nether: details.has_dim_nether,
        has_dim_end: details.has_dim_end,
    })
}

fn import_world_into_server(
    server_dir: &Path,
    server_name: &str,
    input: &WorldImportInput,
    state: &AppState,
    app: &AppHandle,
) -> Result<(), String> {
    let prepared = prepare_world_source(input, &state.data_dir)?;
    let target = server_dir.join("world");
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|err| err.to_string())?;
    }

    copy_dir_with_progress(&prepared.world_root, &target, app, server_name, prepared.size_bytes)?;
    set_level_name(server_dir, "world")?;

    if let Some(staged_root) = prepared.staged_root {
        let temp_root = state.data_dir.join("temp").join("world-import");
        if staged_root.starts_with(&temp_root) {
            let _ = fs::remove_dir_all(staged_root);
        }
    }

    Ok(())
}

#[tauri::command]
fn validate_world_source(
    source_path: String,
    source_kind: String,
    state: State<AppState>,
) -> Result<WorldValidationResult, String> {
    let input = WorldImportInput {
        source_path: source_path.clone(),
        source_kind: source_kind.clone(),
        staged_path: None,
    };
    let prepared = prepare_world_source(&input, &state.data_dir)?;
    let world_name = prepared
        .world_root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("world")
        .to_string();

    Ok(WorldValidationResult {
        valid: true,
        source_kind,
        world_name,
        world_path: prepared.world_root.to_string_lossy().to_string(),
        staged_path: prepared
            .staged_root
            .map(|value| value.to_string_lossy().to_string()),
        size_bytes: prepared.size_bytes,
        has_level_dat: prepared.world_root.join("level.dat").is_file(),
        has_region: prepared.world_root.join("region").is_dir(),
        has_playerdata: prepared.has_playerdata,
        has_data: prepared.has_data,
        has_dim_nether: prepared.has_dim_nether,
        has_dim_end: prepared.has_dim_end,
        detected_version: prepared.detected_version,
        detected_type: prepared.detected_type,
    })
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    if !destination.exists() {
        fs::create_dir_all(destination).map_err(|err| err.to_string())?;
    }

    for entry in WalkDir::new(source) {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let relative = path.strip_prefix(source).map_err(|err| err.to_string())?;
        let target = destination.join(relative);
        if path.is_dir() {
            fs::create_dir_all(&target).map_err(|err| err.to_string())?;
        } else {
            fs::copy(path, &target).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

fn load_settings(server_dir: &Path) -> Result<ServerSettings, String> {
    let path = settings_path(server_dir);
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
        return toml::from_str(&content).map_err(|err| err.to_string());
    }

    let mut settings = ServerSettings::default();
    let props = read_server_properties(server_dir).unwrap_or_default();

    if let Some(value) = props.get("difficulty") {
        settings.difficulty = value.to_lowercase();
    }
    if let Some(value) = props.get("gamemode") {
        settings.gamemode = value.to_lowercase();
    }
    if let Some(value) = props.get("pvp") {
        settings.pvp = value.eq_ignore_ascii_case("true");
    }
    if let Some(value) = props.get("max-players") {
        if let Ok(parsed) = value.parse::<u16>() {
            settings.max_players = parsed;
        }
    }
    if let Some(value) = props.get("view-distance") {
        if let Ok(parsed) = value.parse::<u8>() {
            settings.view_distance = parsed;
        }
    }

    if let Some(value) = props.get("playersSleepingPercentage") {
        if let Ok(percent) = value.parse::<u8>() {
            settings.required_sleeping_players = percentage_to_sleepers(percent, settings.max_players);
        }
    }

    save_settings(server_dir, &settings)?;
    Ok(settings)
}

fn save_settings(server_dir: &Path, settings: &ServerSettings) -> Result<(), String> {
    let content = toml::to_string_pretty(settings).map_err(|err| err.to_string())?;
    fs::write(settings_path(server_dir), content).map_err(|err| err.to_string())
}

fn read_server_properties(server_dir: &Path) -> Result<std::collections::HashMap<String, String>, String> {
    let path = server_dir.join("server.properties");
    if !path.exists() {
        return Ok(std::collections::HashMap::new());
    }

    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut map = std::collections::HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with('!') || !trimmed.contains('=') {
            continue;
        }
        let mut parts = trimmed.splitn(2, '=');
        let key = parts.next().unwrap_or("").trim().to_string();
        let value = parts.next().unwrap_or("").trim().to_string();
        if !key.is_empty() {
            map.insert(key, value);
        }
    }
    Ok(map)
}

fn apply_settings_to_properties(server_dir: &Path, settings: &ServerSettings) -> Result<(), String> {
    let path = server_dir.join("server.properties");
    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;

    let sleep_percentage = sleepers_to_percentage(settings.required_sleeping_players, settings.max_players);
    let updates: std::collections::HashMap<&str, String> = std::collections::HashMap::from([
        ("difficulty", settings.difficulty.to_lowercase()),
        ("gamemode", settings.gamemode.to_lowercase()),
        ("pvp", settings.pvp.to_string()),
        ("max-players", settings.max_players.to_string()),
        ("view-distance", settings.view_distance.to_string()),
        ("playersSleepingPercentage", sleep_percentage.to_string()),
    ]);

    let mut seen = std::collections::HashSet::new();
    let mut lines = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with('!') || !trimmed.contains('=') {
            lines.push(line.to_string());
            continue;
        }

        let mut parts = trimmed.splitn(2, '=');
        let key = parts.next().unwrap_or("").trim();
        if let Some(value) = updates.get(key) {
            lines.push(format!("{}={}", key, value));
            seen.insert(key.to_string());
        } else {
            lines.push(line.to_string());
        }
    }

    for (key, value) in updates {
        if !seen.contains(key) {
            lines.push(format!("{}={}", key, value));
        }
    }

    fs::write(path, format!("{}\n", lines.join("\n"))).map_err(|err| err.to_string())
}

fn sleepers_to_percentage(required: u8, max_players: u16) -> u8 {
    if max_players == 0 {
        return 100;
    }
    let required = required.max(1) as f32;
    let max_players = max_players as f32;
    let percent = (required / max_players * 100.0).ceil();
    percent.clamp(1.0, 100.0) as u8
}

fn percentage_to_sleepers(percent: u8, max_players: u16) -> u8 {
    if max_players == 0 {
        return 1;
    }
    let percent = percent.max(1) as f32;
    let max_players = max_players as f32;
    let required = (percent / 100.0 * max_players).ceil();
    required.max(1.0) as u8
}

fn is_server_running(state: &AppState) -> Result<bool, String> {
    let manager = state
        .process
        .lock()
        .map_err(|_| "Failed to lock process state")?;
    Ok(matches!(
        manager.status(),
        ServerStatus::RUNNING | ServerStatus::STARTING
    ))
}

fn write_server_properties(server_dir: &Path, port: u16, online_mode: bool) -> Result<(), String> {
    let content = format!(
        "server-port={}\nonline-mode={}\nmotd=Gamehost ONE\n",
        port, online_mode
    );
    fs::write(server_dir.join("server.properties"), content).map_err(|err| err.to_string())
}

fn apply_online_mode(server_dir: &Path, online_mode: bool) -> Result<(), String> {
    let path = server_dir.join("server.properties");
    if !path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&path).map_err(|err| err.to_string())?;
    let mut lines = Vec::new();
    let mut updated = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with('!') || !trimmed.contains('=') {
            lines.push(line.to_string());
            continue;
        }

        let mut parts = trimmed.splitn(2, '=');
        let key = parts.next().unwrap_or("").trim();
        if key == "online-mode" {
            lines.push(format!("online-mode={}", online_mode));
            updated = true;
        } else {
            lines.push(line.to_string());
        }
    }

    if !updated {
        lines.push(format!("online-mode={}", online_mode));
    }

    fs::write(path, format!("{}\n", lines.join("\n"))).map_err(|err| err.to_string())
}

fn collect_world_paths(server_dir: &Path, include_nether: bool, include_end: bool) -> Vec<PathBuf> {
    let mut roots = vec![server_dir.join("world")];
    if include_nether {
        roots.push(server_dir.join("world_nether"));
    }
    if include_end {
        roots.push(server_dir.join("world_the_end"));
    }
    roots.into_iter().filter(|path| path.exists()).collect()
}

fn zip_world_to_path(
    server_dir: &Path,
    destination: &Path,
    include_nether: bool,
    include_end: bool,
    app: Option<&AppHandle>,
    progress_event: &str,
    server_id: &str,
) -> Result<u64, String> {
    let roots = collect_world_paths(server_dir, include_nether, include_end);
    if roots.is_empty() {
        return Err("World folder not found".to_string());
    }

    let mut total_bytes: u64 = 0;
    let mut files = Vec::new();
    for root in &roots {
        for entry in WalkDir::new(root) {
            let entry = entry.map_err(|err| err.to_string())?;
            if entry.path().is_file() {
                let size = entry.metadata().map_err(|err| err.to_string())?.len();
                total_bytes += size;
                files.push((root.clone(), entry.path().to_path_buf(), size));
            }
        }
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let file = File::create(destination).map_err(|err| err.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut processed: u64 = 0;

    for (root, path, size) in files {
        let relative = path.strip_prefix(&root).map_err(|err| err.to_string())?;
        let folder_name = root.file_name().and_then(|s| s.to_str()).unwrap_or("world");
        let zip_path = PathBuf::from(folder_name).join(relative);
        zip.start_file(zip_path.to_string_lossy(), options)
            .map_err(|err| err.to_string())?;
        let mut input = File::open(&path).map_err(|err| err.to_string())?;
        let mut buffer = Vec::new();
        input.read_to_end(&mut buffer).map_err(|err| err.to_string())?;
        zip.write_all(&buffer).map_err(|err| err.to_string())?;
        processed = processed.saturating_add(size);

        if let Some(app) = app {
            if total_bytes > 0 {
                let progress = (processed as f64 / total_bytes as f64 * 100.0).min(100.0);
                let _ = app.emit(
                    progress_event,
                    serde_json::json!({
                        "server_id": server_id,
                        "progress": progress,
                        "processed_bytes": processed,
                        "total_bytes": total_bytes
                    }),
                );
            }
        }
    }

    zip.finish().map_err(|err| err.to_string())?;
    Ok(total_bytes)
}

fn perform_backup(
    app: &AppHandle,
    state: &AppState,
    server_id: &str,
    include_nether: bool,
    include_end: bool,
    reason: &str,
) -> Result<BackupEntry, String> {
    let server_dir = resolve_server_dir(state, server_id)?;
    let running = is_server_running(state)?;
    if running {
        let mut manager = state
            .process
            .lock()
            .map_err(|_| "Failed to lock process state")?;
        if manager
            .active_server_id
            .as_deref()
            .is_some_and(|active| active != server_id)
        {
            return Err("Another server is currently running".to_string());
        }
        let _ = manager.send_command("say Creating world backup...");
        let _ = manager.send_command("save-off");
        let _ = manager.send_command("save-all");
    }

    let timestamp = Utc::now();
    let id = timestamp.format("%Y%m%d_%H%M%S").to_string();
    let backup_dir = backups_root(&state.data_dir, server_id);
    fs::create_dir_all(&backup_dir).map_err(|err| err.to_string())?;
    let destination = backup_dir.join(format!("{}.zip", id));
    let size_bytes = zip_world_to_path(
        &server_dir,
        &destination,
        include_nether,
        include_end,
        Some(app),
        "backup:progress",
        server_id,
    )?;

    if running {
        if let Ok(mut manager) = state.process.lock() {
            let _ = manager.send_command("save-on");
        }
    }

    let created_at = timestamp.to_rfc3339();
    let entry = BackupEntry {
        id: id.clone(),
        created_at,
        size_bytes,
        path: destination.to_string_lossy().to_string(),
    };

    let mut manifest = load_backup_manifest(&state.data_dir, server_id)?;
    manifest.push(entry.clone());
    save_backup_manifest(&state.data_dir, server_id, &manifest)?;

    let mut meta = load_server_meta(&state.data_dir, server_id).unwrap_or_default();
    meta.last_backup_at = Some(timestamp.to_rfc3339());
    let _ = save_server_meta(&state.data_dir, server_id, &meta);

    append_log(&state.data_dir, &format!("Backup created ({}) for server: {}", reason, server_id));
    Ok(entry)
}

fn start_backup_scheduler(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        let state = app.state::<AppState>();
        let registry = match load_registry(&state.registry_path, &state.legacy_config_path) {
            Ok(registry) => registry,
            Err(_) => continue,
        };

        for server in registry.servers {
            let meta = match load_server_meta(&state.data_dir, &server.name) {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            if !meta.auto_backup || meta.backup_interval_minutes == 0 {
                continue;
            }

            let last_backup = meta
                .last_backup_at
                .as_ref()
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .map(|value| value.with_timezone(&Utc));

            let due = match last_backup {
                Some(last) => Utc::now() - last > chrono::Duration::minutes(meta.backup_interval_minutes as i64),
                None => true,
            };

            if due {
                let _ = perform_backup(&app, &state, &server.name, true, true, "scheduled");
            }
        }
    });
}

fn write_eula(server_dir: &Path) -> Result<(), String> {
    fs::write(server_dir.join("eula.txt"), "eula=true\n").map_err(|err| err.to_string())
}

fn write_user_jvm_args(server_dir: &Path, ram_gb: u8) -> Result<(), String> {
    let content = format!("-Xms{}G\n-Xmx{}G\n", ram_gb, ram_gb);
    fs::write(server_dir.join("user_jvm_args.txt"), content).map_err(|err| err.to_string())
}

fn install_server(
    config: &ServerConfigInput,
    server_dir: &Path,
    java_exe: Option<&Path>,
) -> Result<LauncherConfig, String> {
    match config.server_type {
        ServerType::Vanilla => install_vanilla(server_dir, &config.version),
        ServerType::Paper => install_paper(server_dir, &config.version),
        ServerType::Forge => {
            let java_path = java_exe.ok_or("Java is required to install Forge.".to_string())?;
            install_forge(server_dir, &config.version, java_path)
        }
        ServerType::Fabric => Err("Fabric install is not supported in the wizard yet. Import an existing Fabric server instead.".to_string()),
    }
}

fn install_vanilla(server_dir: &Path, version: &str) -> Result<LauncherConfig, String> {
    let client = reqwest::blocking::Client::new();
    let manifest: VersionManifest = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .map_err(|err| err.to_string())?
        .json()
        .map_err(|err| err.to_string())?;

    let version_entry = manifest
        .versions
        .into_iter()
        .find(|entry| entry.id == version)
        .ok_or("Version not found in Mojang manifest")?;

    let version_meta: VersionMeta = client
        .get(version_entry.url)
        .send()
        .map_err(|err| err.to_string())?
        .json()
        .map_err(|err| err.to_string())?;

    let server_download = version_meta
        .downloads
        .server
        .ok_or("Server download not available for this version")?;

    ensure_https(&server_download.url)?;
    let jar_path = server_dir.join("server.jar");
    let expected_sha256 = server_download
        .sha256
        .clone()
        .or_else(|| fetch_optional_sha256_from_url(&client, &server_download.url));
    let expected_sha1 = server_download.sha1.clone();

    download_with_hashes(&client, &server_download.url, expected_sha256, expected_sha1, &jar_path)?;

    Ok(LauncherConfig::Jar {
        jar_path: "server.jar".to_string(),
    })
}

fn install_paper(server_dir: &Path, version: &str) -> Result<LauncherConfig, String> {
    let client = reqwest::blocking::Client::new();
    let version_info: PaperVersionInfo = client
        .get(format!(
            "https://api.papermc.io/v2/projects/paper/versions/{}",
            version
        ))
        .send()
        .map_err(|err| err.to_string())?
        .json()
        .map_err(|err| err.to_string())?;

    let build = version_info
        .builds
        .last()
        .copied()
        .ok_or("No Paper builds available")?;

    let build_info: PaperBuildInfo = client
        .get(format!(
            "https://api.papermc.io/v2/projects/paper/versions/{}/builds/{}",
            version, build
        ))
        .send()
        .map_err(|err| err.to_string())?
        .json()
        .map_err(|err| err.to_string())?;

    let download = build_info
        .downloads
        .application
        .ok_or("Paper application download missing")?;
    let url = format!(
        "https://api.papermc.io/v2/projects/paper/versions/{}/builds/{}/downloads/{}",
        version, build, download.name
    );

    ensure_https(&url)?;
    let jar_path = server_dir.join("server.jar");
    download_with_sha256(&client, &url, &download.sha256, &jar_path)?;

    Ok(LauncherConfig::Jar {
        jar_path: "server.jar".to_string(),
    })
}

fn install_forge(server_dir: &Path, version: &str, java_exe: &Path) -> Result<LauncherConfig, String> {
    let client = reqwest::blocking::Client::new();
    let installer_name = format!("forge-{}-installer.jar", version);
    let url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{}/{}",
        version, installer_name
    );

    ensure_https(&url)?;
    let expected_sha256 = fetch_sha256_from_url_strict(&client, &url)?;
    let installer_path = server_dir.join("forge-installer.jar");
    download_with_sha256(&client, &url, &expected_sha256, &installer_path)?;

    let status = Command::new(java_exe)
        .arg("-jar")
        .arg(&installer_path)
        .arg("--installServer")
        .current_dir(server_dir)
        .status()
        .map_err(|err| err.to_string())?;

    if !status.success() {
        return Err("Forge installer failed".to_string());
    }

    let args_file = server_dir
        .join("libraries")
        .join("net")
        .join("minecraftforge")
        .join("forge")
        .join(version)
        .join("win_args.txt");

    if !args_file.exists() {
        return Err("Forge args file missing after installation".to_string());
    }

    let relative_args = args_file
        .strip_prefix(server_dir)
        .map_err(|err| err.to_string())?
        .to_string_lossy()
        .to_string();

    let _ = File::create(server_dir.join("user_jvm_args.txt"));

    Ok(LauncherConfig::Forge {
        args_file: relative_args,
    })
}

fn download_with_sha256(
    client: &reqwest::blocking::Client,
    url: &str,
    expected_sha256: &str,
    destination: &Path,
) -> Result<(), String> {
    ensure_https(url)?;
    let response = client.get(url).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Download failed: {}", response.status()));
    }

    let bytes = response.bytes().map_err(|err| err.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let actual = hex::encode(hasher.finalize());

    if actual.to_lowercase() != expected_sha256.to_lowercase() {
        return Err("SHA256 verification failed".to_string());
    }

    fs::write(destination, &bytes).map_err(|err| err.to_string())?;
    Ok(())
}

fn download_with_sha256_progress(
    client: &reqwest::blocking::Client,
    url: &str,
    expected_sha256: &str,
    destination: &Path,
    app: &AppHandle,
    event: &str,
) -> Result<(), String> {
    ensure_https(url)?;
    let mut response = client.get(url).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Download failed: {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut file = File::create(destination).map_err(|err| err.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut downloaded: u64 = 0;

    loop {
        let read = response.read(&mut buffer).map_err(|err| err.to_string())?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(|err| err.to_string())?;
        hasher.update(&buffer[..read]);
        downloaded += read as u64;
        if total > 0 {
            let progress = ((downloaded as f64 / total as f64) * 100.0).round() as u64;
            let _ = app.emit(event, progress.min(100));
        }
    }

    let actual = hex::encode(hasher.finalize());
    if actual.to_lowercase() != expected_sha256.to_lowercase() {
        return Err("SHA256 verification failed".to_string());
    }

    let _ = app.emit(event, 100u64);
    Ok(())
}

fn download_with_hashes(
    client: &reqwest::blocking::Client,
    url: &str,
    expected_sha256: Option<String>,
    expected_sha1: Option<String>,
    destination: &Path,
) -> Result<(), String> {
    ensure_https(url)?;
    let response = client.get(url).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Download failed: {}", response.status()));
    }

    let bytes = response.bytes().map_err(|err| err.to_string())?;
    if let Some(expected) = expected_sha256 {
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let actual = hex::encode(hasher.finalize());
        if actual.to_lowercase() != expected.to_lowercase() {
            return Err("SHA256 verification failed".to_string());
        }
        fs::write(destination, &bytes).map_err(|err| err.to_string())?;
        return Ok(());
    }

    if let Some(expected) = expected_sha1 {
        let mut hasher = Sha1::new();
        hasher.update(&bytes);
        let actual = hex::encode(hasher.finalize());
        if actual.to_lowercase() != expected.to_lowercase() {
            return Err("SHA1 verification failed".to_string());
        }
        fs::write(destination, &bytes).map_err(|err| err.to_string())?;
        return Ok(());
    }

    Err("No hash available for verification".to_string())
}

fn ensure_https(url: &str) -> Result<(), String> {
    if url.starts_with("https://") {
        Ok(())
    } else {
        Err("Only HTTPS downloads are allowed".to_string())
    }
}

fn fetch_optional_sha256_from_url(client: &reqwest::blocking::Client, url: &str) -> Option<String> {
    let checksum_url = format!("{}.sha256", url);
    if ensure_https(&checksum_url).is_err() {
        return None;
    }
    let response = client.get(checksum_url).send().ok()?;
    if !response.status().is_success() {
        return None;
    }

    let text = response.text().ok()?;
    let value = text.split_whitespace().next()?;
    Some(value.to_string())
}

fn fetch_adoptium_package(required_major: u32) -> Result<AdoptiumPackage, String> {
    let client = reqwest::blocking::Client::new();
    let url = format!(
        "https://api.adoptium.net/v3/assets/latest/{}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse",
        required_major
    );
    ensure_https(&url)?;
    let response = client
        .get(url)
        .header("User-Agent", "GameHostONE")
        .header("Accept", "application/json")
        .send()
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Adoptium API error: {}", response.status()));
    }
    let body = response.text().map_err(|err| err.to_string())?;
    let root: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| "Adoptium API returned unexpected data".to_string())?;

    let package = root
        .as_array()
        .and_then(|assets| assets.first())
        .and_then(|asset| {
            asset
                .get("binary")
                .and_then(|binary| binary.get("package"))
                .or_else(|| {
                    asset
                        .get("binaries")
                        .and_then(|binaries| binaries.as_array())
                        .and_then(|binaries| binaries.first())
                        .and_then(|binary| binary.get("package"))
                })
        })
        .and_then(|package| package.as_object())
        .ok_or("No Adoptium binaries found".to_string())?;

    let link = package
        .get("link")
        .and_then(|value| value.as_str())
        .ok_or("Missing Adoptium download link".to_string())?;
    let checksum = package
        .get("checksum")
        .and_then(|value| value.as_str())
        .ok_or("Missing Adoptium checksum".to_string())?;
    let name = package
        .get("name")
        .and_then(|value| value.as_str())
        .ok_or("Missing Adoptium package name".to_string())?;

    Ok(AdoptiumPackage {
        link: link.to_string(),
        checksum: checksum.to_string(),
        name: name.to_string(),
    })
}

fn extract_java_zip(zip_path: &Path, runtime_dir: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|err| err.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;
    let temp_root = runtime_dir
        .parent()
        .ok_or("Invalid runtime directory")?
        .join("java_extract");

    if temp_root.exists() {
        fs::remove_dir_all(&temp_root).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(&temp_root).map_err(|err| err.to_string())?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|err| err.to_string())?;
        let Some(enclosed) = entry.enclosed_name() else { continue };
        let out_path = temp_root.join(enclosed);
        if entry.name().ends_with('/') {
            fs::create_dir_all(&out_path).map_err(|err| err.to_string())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let mut out_file = File::create(&out_path).map_err(|err| err.to_string())?;
        std::io::copy(&mut entry, &mut out_file).map_err(|err| err.to_string())?;
    }

    let extracted_root = fs::read_dir(&temp_root)
        .map_err(|err| err.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .find(|path| path.is_dir())
        .ok_or("Extracted runtime folder not found".to_string())?;

    if runtime_dir.exists() {
        fs::remove_dir_all(runtime_dir).map_err(|err| err.to_string())?;
    }

    if let Err(err) = fs::rename(&extracted_root, runtime_dir) {
        copy_dir_recursive(&extracted_root, runtime_dir)?;
        fs::remove_dir_all(&extracted_root).map_err(|inner| format!("{}; {}", err, inner))?;
    }

    fs::remove_dir_all(&temp_root).map_err(|err| err.to_string())?;
    Ok(())
}

fn download_java_runtime(required_major: u32, base: &Path, app: &AppHandle) -> Result<PathBuf, String> {
    let package = fetch_adoptium_package(required_major)?;
    ensure_https(&package.link)?;

    let client = reqwest::blocking::Client::new();
    let runtime_dir = runtime_java_dir(base);
    fs::create_dir_all(&runtime_dir).map_err(|err| err.to_string())?;

    let zip_path = runtime_dir.join(&package.name);
    download_with_sha256_progress(&client, &package.link, &package.checksum, &zip_path, app, "java:download")?;
    extract_java_zip(&zip_path, &runtime_dir)?;
    let _ = fs::remove_file(&zip_path);

    Ok(runtime_java_exe(base))
}

fn fetch_sha256_from_url_strict(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let checksum_url = format!("{}.sha256", url);
    ensure_https(&checksum_url)?;
    let response = client.get(checksum_url).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err("SHA256 checksum not available from source".to_string());
    }

    let text = response.text().map_err(|err| err.to_string())?;
    let value = text
        .split_whitespace()
        .next()
        .ok_or("Invalid SHA256 checksum")?;
    Ok(value.to_string())
}

fn fetch_public_ip() -> Result<String, String> {
    #[derive(Deserialize)]
    struct IpResponse {
        ip: String,
    }

    let client = reqwest::blocking::Client::new();
    let response: IpResponse = client
        .get("https://api.ipify.org?format=json")
        .send()
        .map_err(|err| err.to_string())?
        .json()
        .map_err(|err| err.to_string())?;
    Ok(response.ip)
}

fn check_port_open(ip: &str, port: u16) -> bool {
    let addr = format!("{}:{}", ip, port);
    if let Ok(socket_addr) = addr.parse() {
        TcpStream::connect_timeout(&socket_addr, Duration::from_secs(3)).is_ok()
    } else {
        false
    }
}

#[derive(Debug, Deserialize)]
struct VersionManifest {
    versions: Vec<VersionEntry>,
}

#[derive(Debug, Deserialize)]
struct VersionEntry {
    id: String,
    url: String,
}

#[derive(Debug, Deserialize)]
struct VersionMeta {
    downloads: VersionDownloads,
}

#[derive(Debug, Deserialize)]
struct VersionDownloads {
    server: Option<ServerDownload>,
}

#[derive(Debug, Deserialize)]
struct ServerDownload {
    url: String,
    sha256: Option<String>,
    sha1: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PaperVersionInfo {
    builds: Vec<u32>,
}

#[derive(Debug, Deserialize)]
struct PaperBuildInfo {
    downloads: PaperDownloads,
}

#[derive(Debug, Deserialize)]
struct PaperDownloads {
    application: Option<PaperDownload>,
}

#[derive(Debug, Deserialize)]
struct PaperDownload {
    name: String,
    sha256: String,
}

#[derive(Debug, Deserialize, Clone)]
struct AdoptiumPackage {
    link: String,
    checksum: String,
    name: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle();
            let data_dir = app_data_dir(&handle)?;
            ensure_app_dirs(&data_dir)?;

            let hook_handle = handle.clone();
            let hook_dir = data_dir.clone();
            std::panic::set_hook(Box::new(move |info| {
                let message = if let Some(payload) = info.payload().downcast_ref::<&str>() {
                    payload.to_string()
                } else if let Some(payload) = info.payload().downcast_ref::<String>() {
                    payload.clone()
                } else {
                    "Unexpected panic".to_string()
                };
                let location = info
                    .location()
                    .map(|loc| format!("{}:{}", loc.file(), loc.line()))
                    .unwrap_or_else(|| "unknown".to_string());
                let full_message = format!("{} ({})", message, location);
                let settings = load_app_settings(&hook_dir);
                let app_version = hook_handle.package_info().version.to_string();
                write_crash_report(&hook_dir, &settings, &app_version, &full_message);
            }));

            let state = AppState {
                data_dir: data_dir.clone(),
                registry_path: registry_path(&data_dir),
                legacy_config_path: legacy_config_path(&data_dir),
                process: Arc::new(Mutex::new(ProcessManager::new())),
            };

            app.manage(state);
            setup_tray(&handle)?;
            start_backup_scheduler(handle.clone());

            if let Some(window) = app.get_webview_window("main") {
                apply_webview_corner_preference(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    let _ = window.hide();
                    api.prevent_close();
                }
                WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                    apply_window_corner_preference(window);
                }
                _ => {}
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_server_config,
            create_server,
            list_servers,
            get_active_server_id,
            start_server,
            stop_server,
            restart_server,
            send_console_command,
            get_status,
            get_resource_usage,
            get_network_info,
            get_system_ram,
            check_java,
            set_java_path,
            download_java,
            get_server_settings,
            update_server_settings,
            apply_server_settings,
            update_server_config,
            delete_server,
            reinstall_server,
            analyze_server_folder_cmd,
            import_server,
            validate_world_source,
            validate_mods_source,
            export_world,
            get_server_meta,
            get_server_metadata,
            detect_server_metadata,
            update_server_meta,
            create_backup,
            list_backups,
            delete_backup,
            restore_backup,
            list_mods,
            add_mod,
            add_mod_with_meta,
            toggle_mod,
            get_modpack,
            check_mod_sync,
            download_mods,
            detect_minecraft_client,
            get_client_version_info,
            launch_minecraft,
            get_app_settings,
            update_app_settings,
            list_crash_reports,
            get_crash_report,
            delete_crash_report,
            clear_crash_reports,
            export_crash_reports,
            check_for_updates,
            download_update,
            get_forge_versions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_tray(app: &AppHandle) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{TrayIconBuilder, TrayIconEvent};

    if TRAY_READY.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    let open = MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let start = MenuItem::with_id(app, "start", "Start Server", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let stop = MenuItem::with_id(app, "stop", "Stop Server", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let restart = MenuItem::with_id(app, "restart", "Restart Server", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)
        .map_err(|err| err.to_string())?;

    let menu = Menu::with_items(app, &[&open, &start, &stop, &restart, &exit])
        .map_err(|err| err.to_string())?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("Missing tray icon")?;

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("Gamehost ONE")
        .menu(&menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "start" => {
                if let Some(server_id) = get_preferred_server_id(&*app.state::<AppState>()) {
                    let _ = start_server(server_id, app.state(), app.clone());
                }
            }
            "stop" => {
                let active = app
                    .state::<AppState>()
                    .process
                    .lock()
                    .ok()
                    .and_then(|manager| manager.active_server_id.clone());
                if let Some(server_id) = active {
                    let _ = stop_server(server_id, app.state(), app.clone());
                }
            }
            "restart" => {
                let active = app
                    .state::<AppState>()
                    .process
                    .lock()
                    .ok()
                    .and_then(|manager| manager.active_server_id.clone());
                if let Some(server_id) = active {
                    let _ = restart_server(server_id, app.state(), app.clone());
                }
            }
            "exit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)
        .map_err(|err| err.to_string())?;

    Ok(())
}
