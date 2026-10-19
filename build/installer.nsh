!macro customInstall
  ; start Notch with Windows (written by the installer itself, so it works even before first launch)
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Notch"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.zaid.notch"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Notch" '"$INSTDIR\Notch.exe" --autostart'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Notch"
!macroend
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Notch"
!macroend
