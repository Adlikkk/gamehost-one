!macro NSIS_HOOK_PREINSTALL
  ; Clean legacy uninstall shortcuts left behind by older installers in the app directory.
  Delete "$INSTDIR\Uninstall*.lnk"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Remove legacy uninstall shortcuts before RMDir runs so the install folder can be removed fully.
  Delete "$INSTDIR\Uninstall*.lnk"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
  DeleteRegKey /ifempty SHCTX "${MANUKEY}"
  DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
  DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
  DeleteRegKey /ifempty HKCU "${MANUKEY}"
!macroend
