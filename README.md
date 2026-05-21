# GameHost ONE

GameHost ONE is a local-first Windows desktop app for creating, importing, and managing Minecraft servers on your own machine.

## Beta Installer

- Recommended public beta installer: `GameHost-ONE-Setup-vX.Y.Z.exe`
- Installer type: NSIS `.exe`
- MSI is not distributed during beta until it passes clean Windows VM validation

## What The App Handles

- Vanilla, Paper, and Forge server setup
- Existing server and world import
- Local backups and restore
- Java runtime download and management
- Resource monitoring, tray controls, notifications, and local crash logs

## Privacy

- No telemetry by default
- No tracking
- No ads
- Update checks use GitHub Releases metadata
- App data stays under `%APPDATA%\com.gamehost.one` unless you explicitly export or delete it

## Logs And App Data

- App data root: `%APPDATA%\com.gamehost.one`
- Logs: `%APPDATA%\com.gamehost.one\logs`
- Configs: `%APPDATA%\com.gamehost.one\configs`
- Managed local servers: `%APPDATA%\com.gamehost.one\servers`
- Backups: `%APPDATA%\com.gamehost.one\backups`

## Uninstall Behavior

- Default uninstall removes the installed app only
- Default uninstall keeps your GameHost ONE settings, logs, backups, and managed server data
- Uninstall does not offer AppData deletion in the NSIS UI
- Use `Settings -> Storage -> Danger Zone` inside the app if you want to delete GameHost ONE AppData safely
- Linked external server folders outside GameHost ONE storage are not deleted by the in-app data deletion flow

For full removal steps and stale legacy uninstall entry cleanup, see [docs/troubleshooting/windows-uninstall.md](docs/troubleshooting/windows-uninstall.md).

## Build Notes

- `npm run tauri build` builds the beta NSIS installer only
- `npm run tauri:build:msi` is the separate MSI build path for explicit validation work

## Legal

GameHost ONE is not affiliated with Mojang or Microsoft.
