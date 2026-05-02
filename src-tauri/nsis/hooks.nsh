!macro NSIS_HOOK_PREINSTALL
  ; Check if a previous installation exists and offer to keep/remove data
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 skip_uninstall_prompt

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "A previous version of ${PRODUCTNAME} was found. Choose how to handle existing data:"
  Pop $0

  ${NSD_CreateRadioButton} 10u 36u 100% 12u "Do Not Uninstall — Keeps all playlists and settings"
  Pop $1
  ${NSD_SetState} $1 ${BST_CHECKED}

  ${NSD_CreateRadioButton} 10u 54u 100% 12u "Uninstall — Removes all playlists and settings"
  Pop $2

  nsDialogs::Show

  ${NSD_GetState} $2 $3
  ${If} $3 == ${BST_CHECKED}
    ; User chose to remove data — delete app data directory
    RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}

  skip_uninstall_prompt:
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
