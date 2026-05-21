# Changelog

## 2026-05-21

- Release v0.5.1 for the beta workflow cleanup, in-app danger delete flow, Ko-fi support link, and NSIS-only packaging/update path.

## 2026-05-21

- Removed NSIS uninstall AppData deletion UI so uninstall now removes Program Files, shortcuts, and registry entries while preserving AppData by default.
- Added `Settings -> Storage -> Danger Zone` with typed confirmation for deleting only whitelisted GameHost ONE AppData content, while preserving linked external server folders.
- Added a configurable `Support on Ko-fi` button in `Settings -> About` that opens the external support page without embedding third-party widgets or scripts.
- Aligned update discovery and installer launch with the beta NSIS `.exe` release asset instead of MSI-only update handling.
- Kept the default beta packaging flow limited to `GameHost-ONE-Setup-vX.Y.Z.exe`, its `.sha256`, and `SHA256SUMS.txt`, and updated the docs and packaging report to match.

## 2026-05-20

- Hardened the server lifecycle state machine with backend-owned `PREPARING` and `STOPPING` states and removed time-based `RUNNING` inference.
- Made backup restore STOPPED-only and transactional with safe zip extraction and rollback-safe world swapping.
- Added MSI SHA256 verification to update installation and checksum generation to the GitHub release workflow.
- Disabled release devtools, added a deliberate Tauri CSP, completed notification preferences, added a close-to-tray setting, and normalized visible `GameHost ONE` branding.
- Renamed the packaged executable to `GameHostONE.exe`, fixed packaged install/window branding to `GameHost ONE`, added branded NSIS/WiX installer artwork, and wrapped `npm run tauri build` so NSIS succeeds while WiX MSI is completed through a local `light -sval` fallback.
- Added release startup logging to `%APPDATA%\\com.gamehost.one\\logs\\app.log` and a settings migration that rewrites legacy snake_case app settings into the new camelCase schema.
- Cleaned up NSIS uninstall behavior so the install directory is removed fully, user data is preserved by default, and `/DELETEAPPDATA` removes only GameHost ONE-managed AppData content while leaving linked external server folders untouched.
- Added a `Settings -> Storage` section with app-data/log/runtime paths plus safe cleanup actions for logs, downloaded Java runtimes, and temporary files.
- Added Windows uninstall troubleshooting documentation for stale legacy `Gamehost ONE` entries without auto-deleting arbitrary old MSI metadata.
- Switched the default beta packaging flow to NSIS-only, cleaned bundle artifacts before build, renamed the public installer to `GameHost-ONE-Setup-vX.Y.Z.exe`, and generated `.sha256` plus `SHA256SUMS.txt` without producing MSI artifacts.
