; PlateVault NSIS installer settings, wired in through
; bundle > windows > nsis > installerHooks in tauri.conf.json.
;
; Tauri includes this file before it declares the installer pages. The MUI
; defines below therefore apply to the first page that reads them: the
; license page Tauri adds for bundle > licenseFile (tauri.windows.conf.json),
; which shows installer/privacy-notice.txt. They present that page as a
; privacy notice the user reads, not a licence the user must accept
; (SignPath condition b, astro-plan-vmxcu). installer/wix-en-US.wxl does the
; same for the MSI. Keep privacy-notice.txt in step with
; docs/manual/11-privacy.md.
;
; The installer ships English only (bundle > windows > nsis > languages is
; unset), so these strings are English. Adding a language needs language
; strings here instead of literals.
;
; The file defines no NSIS_HOOK_* macros: PlateVault needs no install or
; uninstall hooks.

!define MUI_PAGE_HEADER_TEXT "Privacy notice"
!define MUI_PAGE_HEADER_SUBTEXT "What PlateVault sends over the internet, and how to turn it off."
!define MUI_LICENSEPAGE_TEXT_TOP "Please read this before you install PlateVault."
!define MUI_LICENSEPAGE_TEXT_BOTTOM "Click Next to continue."
!define MUI_LICENSEPAGE_BUTTON "$(^NextBtn)"
