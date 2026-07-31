; YTM Free — uninstaller configuration/database cleanup (R17 Phase G.1).
;
; Runs only when the built-in "Delete application data" checkbox was
; selected and this is not an in-place update (mirrors the built-in
; ${DeleteAppDataCheckboxState} / ${UpdateMode} guard used a few lines
; earlier in the generated installer.nsi for the WebView2 cache cleanup).
;
; Deletes only the known YTM-Free-owned database files under the resolved
; data directory, then removes the directory itself only if it is left
; empty afterward. Never recurses, never touches a parent directory, and
; never references YTM_FREE_DOWNLOAD_DIR or any downloaded media.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ReadEnvStr $R0 "YTM_FREE_DATA_DIR"
    StrCpy $R1 $R0 1 1
    ${If} $R1 != ":"
      ; No valid absolute drive-letter override: fall back to the app's
      ; real default (dirs::data_dir()\ytm-free — see
      ; src-tauri/src/db.rs, Db::get_db_path()).
      SetShellVarContext current
      StrCpy $R0 "$APPDATA\ytm-free"
    ${EndIf}
    DetailPrint "YTM Free: removing configuration from $R0"
    Delete "$R0\ytm-free.db"
    Delete "$R0\ytm-free.db-wal"
    Delete "$R0\ytm-free.db-shm"
    RMDir "$R0"
  ${EndIf}
!macroend
