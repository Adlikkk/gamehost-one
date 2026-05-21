# GameHost ONE Beta Smoke Test Report

Date: 2026-05-21
Environment: current shell session on `desktop-v4h1ccv\codexsandboxonline`
AppData root observed in this session: `C:\Users\Adam\AppData\Roaming`

This report does not mark beta packaging complete. Tests 1 to 3 were not run because this session is not a confirmed clean Windows VM or disposable Windows user profile, and those tests would touch real install locations and `%APPDATA%`.

Update on 2026-05-21 after final packaged verification request:
- The environment is still not a clean Windows VM or disposable Windows user profile.
- `whoami` returned `desktop-v4h1ccv\codexsandboxonline`.
- `%APPDATA%` still resolves to `C:\Users\Adam\AppData\Roaming`.
- `C:\Program Files\GameHost ONE` already exists on this machine.
- Because of that, the requested install/uninstall/AppData deletion workflow was not executed here.

## Test 1 - Install

Status: Not tested

Evidence / notes:
- Not executed in this session.
- The requested test requires installing `GameHost-ONE-Setup-v0.5.1.exe` into `C:\Program Files\GameHost ONE`, launching the packaged app, checking the tray icon, and verifying runtime logs in a disposable environment.
- This session resolves `%APPDATA%` to `C:\Users\Adam\AppData\Roaming`, so running the installer and app-launch checks here would not satisfy the isolation requirement.
- On the latest re-check, `C:\Program Files\GameHost ONE` already existed before the test run, so this machine was not a clean install target.

## Test 2 - Uninstall keeps data

Status: Not tested

Evidence / notes:
- Not executed in this session.
- The requested test requires changing a real app setting, uninstalling the packaged app, confirming Program Files removal, and verifying settings persistence after reinstall.
- That flow was skipped because it would modify machine install state and user profile data outside a confirmed disposable VM/profile.
- The latest re-check still showed a non-disposable `%APPDATA%` path and an existing `C:\Program Files\GameHost ONE` folder.

## Test 3 - In-app Danger Zone deletion

Status: Not tested

Evidence / notes:
- Not executed in this session.
- The requested test requires deleting `%APPDATA%\com.gamehost.one` through `Settings -> Storage -> Danger Zone`.
- That deletion was intentionally not run because `%APPDATA%` in this session points to `C:\Users\Adam\AppData\Roaming`, which is not a confirmed disposable profile.
- This step remains blocked until the verification is rerun in a clean VM or disposable Windows user profile.

## Test 4 - Update asset naming

Status: Passed

Evidence / notes:
- The beta update checker now expects the NSIS `.exe` asset:
  - `apps/desktop/src-tauri/src/lib.rs:2462` matches `url.ends_with(".exe") && url.contains("gamehost-one-setup-v")`
  - `apps/desktop/src-tauri/src/lib.rs:2478` matches `url.ends_with(".exe.sha256") && url.contains("gamehost-one-setup-v")`
- The installer launch path uses the downloaded executable directly:
  - `apps/desktop/src-tauri/src/lib.rs:2527` uses `Command::new(&path)`
- The beta checksum files match the packaged installer:
  - `SHA256SUMS.txt`: `976a20fc87a06c708873c1a6b1243569106da61901f4248d2a0d75accfb77816  GameHost-ONE-Setup-v0.5.1.exe`
  - `GameHost-ONE-Setup-v0.5.1.exe.sha256`: `976a20fc87a06c708873c1a6b1243569106da61901f4248d2a0d75accfb77816  GameHost-ONE-Setup-v0.5.1.exe`
  - `Get-FileHash` on `GameHost-ONE-Setup-v0.5.1.exe` returned the same SHA256 value.
- No MSI reference was found in the beta update flow scan that covered:
  - `apps/desktop/src-tauri/src/lib.rs`
  - `apps/desktop/src-tauri/tauri.conf.json`
  - `apps/desktop/scripts/tauri.mjs`

## Test 5 - Release bundle

Status: Passed

Evidence / notes:
- Observed bundle contents:
  - `apps/desktop/src-tauri/target/release/bundle/nsis/GameHost-ONE-Setup-v0.5.1.exe`
  - `apps/desktop/src-tauri/target/release/bundle/nsis/GameHost-ONE-Setup-v0.5.1.exe.sha256`
  - `apps/desktop/src-tauri/target/release/bundle/SHA256SUMS.txt`
- `apps/desktop/src-tauri/target/release/bundle/msi` does not exist.
- `apps/desktop/src-tauri/tauri.conf.json:32` sets bundle `targets` to `["nsis"]`.

## Overall

Beta packaging is not complete yet.

Reason:
- Tests 1 to 3 are required and were not run.
- A complete beta sign-off requires rerunning this smoke suite inside a clean Windows VM or a disposable Windows user profile and getting `Passed` for all five tests.
