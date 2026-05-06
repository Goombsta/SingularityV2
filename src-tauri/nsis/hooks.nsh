!macro NSIS_HOOK_PREINSTALL
  ; Check if a previous installation exists and offer to keep/remove data.
  ; Uses MessageBox (native) because nsDialogs does not integrate with the
  ; NSIS installer's Next button when called from a hook (not a MUI page).
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 skip_uninstall_prompt
  MessageBox MB_YESNO|MB_ICONQUESTION "A previous version of ${PRODUCTNAME} was found.$\n$\nDo you want to keep your playlists and settings?$\n$\nYes = Keep data   |   No = Remove data" IDYES skip_uninstall_prompt
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
  skip_uninstall_prompt:
!macroend

!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
!macroend
