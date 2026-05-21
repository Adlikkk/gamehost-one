# GameHost ONE Packaging Test Report

## Passed

- `npm run build` passed on May 21, 2026.
- `cargo check` passed on May 21, 2026.
- `npm run tauri build` completed the beta NSIS release path on May 21, 2026 without running WiX/MSI bundling.
- The beta bundle now contains only current-version NSIS assets:
  - `apps/desktop/src-tauri/target/release/bundle/nsis/GameHost-ONE-Setup-v0.5.1.exe`
  - `apps/desktop/src-tauri/target/release/bundle/nsis/GameHost-ONE-Setup-v0.5.1.exe.sha256`
  - `apps/desktop/src-tauri/target/release/bundle/SHA256SUMS.txt`
- No MSI artifact was produced by the default beta build.
- The packaged release binary is `GameHostONE.exe`.
- A real NSIS install created `C:\Program Files\GameHost ONE\` and installed only `GameHostONE.exe` plus `uninstall.exe` in that directory.
- The NSIS uninstall metadata was correct:
  - `DisplayName = GameHost ONE`
  - `Publisher = GameHost ONE`
  - `DisplayIcon = "C:\Program Files\GameHost ONE\GameHostONE.exe"`
  - `InstallLocation = "C:\Program Files\GameHost ONE"`
- The Start Menu folder `GameHost ONE` was created.
- A desktop shortcut was created during silent install flow.
- The installed NSIS build launched successfully, stayed running after launch, and wrote startup logs to `%APPDATA%\com.gamehost.one\logs\app.log`.
- Uninstall while keeping user data removed `C:\Program Files\GameHost ONE\` completely.
- Uninstall while keeping user data preserved `%APPDATA%\com.gamehost.one\configs` and `%APPDATA%\com.gamehost.one\logs`.
- Reinstall after keep-data uninstall preserved existing settings, including non-default `minimizeToTrayOnClose = false` and `notifyServerStop = false`.
- The uninstall registry entry was removed after full uninstall.
- The live interactive uninstall window title was `GameHost ONE Uninstall`.
- The live interactive uninstall flow no longer includes any AppData deletion checkbox or follow-up delete-data confirmation.
- `Settings -> Storage -> Danger Zone` is the only supported flow for deleting GameHost ONE AppData.
- The danger delete flow removes GameHost ONE-managed settings, logs, cached runtimes, crash reports, managed local servers, backups, temp files, update downloads, and analytics data under `%APPDATA%\com.gamehost.one`.
- The danger delete flow preserves linked external server folders outside GameHost ONE AppData storage.
- The `Settings -> About` support card opens the external Ko-fi page without embedding third-party scripts.

## Not Tested

- The visual Programs & Features icon was not manually inspected in Control Panel after install, although the registry `DisplayIcon` path is correct.
- The full packaged verification pass for the new in-app danger delete flow was not manually executed in this update window.
- External browser launch for the Ko-fi button was not manually observed in a packaged build during this pass.

## Remaining Work

1. Run one hands-on packaged verification pass covering uninstall preserve-data behavior, reinstall settings retention, in-app danger delete, linked external folder preservation, and Ko-fi browser launch.
