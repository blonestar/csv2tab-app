; Samo „Otvori pomoću“ za trenutnog korisnika. Podrazumevana vrednost ekstenzije i UserChoice se ne diraju.
!macro csv2tabOpenWith EXT DESCRIPTION
  WriteRegStr HKCU "Software\Classes\csv2tab.${EXT}" "" "${DESCRIPTION}"
  WriteRegStr HKCU "Software\Classes\csv2tab.${EXT}\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\csv2tab.${EXT}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegNone HKCU "Software\Classes\.${EXT}\OpenWithProgids" "csv2tab.${EXT}"
!macroend

!macro csv2tabForgetOpenWith EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "csv2tab.${EXT}"
  DeleteRegKey HKCU "Software\Classes\csv2tab.${EXT}"
!macroend

!macro customInstall
  !insertmacro csv2tabOpenWith "csv" "CSV krojna lista"
  !insertmacro csv2tabOpenWith "ods" "ODS krojna lista"
  !insertmacro csv2tabOpenWith "xlsx" "Excel krojna lista"
  !insertmacro csv2tabOpenWith "tab" "WT Input krojna lista"
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

!macro customUnInstall
  !insertmacro csv2tabForgetOpenWith "csv"
  !insertmacro csv2tabForgetOpenWith "ods"
  !insertmacro csv2tabForgetOpenWith "xlsx"
  !insertmacro csv2tabForgetOpenWith "tab"
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend
