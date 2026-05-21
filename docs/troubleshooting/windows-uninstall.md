# Windows Uninstall Troubleshooting

## Stale `Gamehost ONE` entries in Apps & Features

Older test builds used mixed `Gamehost ONE` / `GameHost ONE` metadata. On some Windows machines that can leave behind a stale uninstall entry even after the current NSIS build is removed.

GameHost ONE does not try to delete unknown legacy uninstall entries automatically. That is intentional. Windows uninstall metadata can be shared with older MSI test installs, and aggressive cleanup would risk removing unrelated entries on a developer machine.

## Safe cleanup steps

1. Uninstall the current `GameHost ONE` entry from Settings or Control Panel first.
2. Open `C:\Program Files\GameHost ONE\` and confirm the folder is gone. If Windows still shows the folder, remove only leftover shortcuts or empty folders after all `GameHost ONE` processes are closed.
3. Open `regedit`.
4. Check these uninstall locations for stale `Gamehost ONE` entries:
   - `HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall`
   - `HKEY_LOCAL_MACHINE\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`
5. Only remove a registry key if all of the following match:
   - `DisplayName` is `Gamehost ONE`
   - `Publisher` matches the old test build
   - `InstallLocation` points to an already-removed GameHost ONE folder
   - `UninstallString` points to a missing MSI product or missing install path
6. Restart Windows Settings and confirm the stale entry is gone.

## User data

Current NSIS uninstall keeps `%APPDATA%\com.gamehost.one` by default. The uninstall UI does not delete AppData.

If you want to remove GameHost ONE AppData, use `Settings -> Storage -> Danger Zone` inside the app. That flow deletes only GameHost ONE-managed data under `%APPDATA%\com.gamehost.one`.

Linked or imported external server folders outside GameHost ONE AppData storage are not deleted by the in-app data deletion flow.
