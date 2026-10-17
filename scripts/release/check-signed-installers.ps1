[CmdletBinding()]
param(
  [ValidateSet('Check', 'CliGuard', 'SignatureSet', 'Mutate')]
  [string] $Mode = 'Check',
  [string] $Lockfile = (Join-Path (Get-Location).Path 'pnpm-lock.yaml'),
  [string] $CheckedCliVersion = '2.12.2',
  [string] $AppSignedDirectory = 'app-signed',
  [string] $InstallersToSignDirectory = 'installers-to-sign',
  [string] $InstallersSignedDirectory = 'installers-signed',
  [string] $UnpackedDirectory = 'unpacked',
  [string] $AuthenticodeSigner = $env:AUTHENTICODE_SIGNER,
  [string] $AuthenticodeIssuer = $env:AUTHENTICODE_ISSUER,
  [string] $SignatureBaseDirectory = 'installers-to-sign',
  [string] $SignatureOutputDirectory = 'installers-signed',
  [string] $MutationCase,
  [string] $NsDialogsPin = 'B1350F487692057C8FFDE75DCC55287A52A3272240D4D4912F24464B27551FC0',
  [string] $WixSigner = 'WiX Toolset (.NET Foundation)',
  [string] $WixIssuer = '.NET Foundation Projects Code Signing CA2',
  [switch] $SkipExtraction
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

function Assert-TauriCliVersion([string] $Path) {
  $lock = [System.IO.File]::ReadAllText($Path)
  $pattern = "(?ms)^  apps/desktop:\r?\n.*?^      '@tauri-apps/cli':\r?\n        specifier: [^\r\n]+\r?\n        version: ([^\r\n(]+)"
  $cli = [regex]::Match($lock, $pattern)
  if (-not $cli.Success -or $cli.Groups[1].Value -cne $CheckedCliVersion) {
    $actual = if ($cli.Success) { $cli.Groups[1].Value } else { 'not found' }
    throw "The NSS/MSI stamp code was checked against Tauri CLI $CheckedCliVersion, but pnpm-lock.yaml resolves $actual. Re-check the bundler codes, five NSIS SHA-256 pins, and WixUIWixca publisher/issuer before changing this guard."
  }
}

function Get-Identity([string] $Path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  $signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.GetNameInfo('SimpleName', $false) } else { 'nobody' }
  $issuer = if ($signature.SignerCertificate) { $signature.SignerCertificate.GetNameInfo('SimpleName', $true) } else { 'nobody' }
  return @{ Status=$signature.Status; Signer=$signer; Issuer=$issuer }
}

function Test-PortableExecutable([string] $Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $reader = [System.IO.BinaryReader]::new($stream)
    if ($stream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5A4D) { return $false }
    $stream.Position = 0x3C
    $header = [long]$reader.ReadUInt32()
    if ($header + 4 -gt $stream.Length) { return $false }
    $stream.Position = $header
    return $reader.ReadUInt32() -eq 0x00004550
  } finally { $stream.Dispose() }
}

function Expand-With7Zip([string] $Archive, [string] $Destination, [string[]] $Options = @()) {
  & { $PSNativeCommandUseErrorActionPreference = $false; 7z x @Options $Archive "-o$Destination" -y | Out-Null }
  if ($LASTEXITCODE -gt 1) { throw "7-Zip could not unpack ${Archive}: exit code $LASTEXITCODE" }
}

function Test-SignPathSignatures([string] $InputDirectory, [string] $OutputDirectory, [string] $ExpectedIssuer = $AuthenticodeIssuer) {
  foreach ($installer in Get-ChildItem -Recurse -File $InputDirectory) {
    $relative = [System.IO.Path]::GetRelativePath((Resolve-Path $InputDirectory).Path, $installer.FullName)
    $signed = Join-Path $OutputDirectory $relative
    if (-not (Test-Path -LiteralPath $signed -PathType Leaf)) { throw "SignPath returned no $signed. The artifact configuration must keep each file at its path." }
    $identity = Get-Identity $signed
    if ($identity.Status -ne 'Valid' -or $identity.Signer -cne $AuthenticodeSigner -or $identity.Issuer -cne $ExpectedIssuer) {
      throw "$signed must carry a valid signature by $AuthenticodeSigner issued by $ExpectedIssuer, found: $($identity.Status) by '$($identity.Signer)' issued by '$($identity.Issuer)'"
    }
  }
}

function Check-InstallerContents(
  [string] $Pin,
  [string] $Publisher,
  [string] $Issuer,
  [switch] $SkipExtract
) {
  if (-not $SkipExtract) {
    $setup = Get-Item (Join-Path $InstallersSignedDirectory '*-setup.exe')
    $msi = Get-Item (Join-Path $InstallersSignedDirectory '*.msi')
    Expand-With7Zip $setup.FullName (Join-Path $UnpackedDirectory 'nsis')
    Expand-With7Zip $msi.FullName (Join-Path $UnpackedDirectory 'msi-streams') @('-tCompound')
    $target = Join-Path $UnpackedDirectory 'msi'
    New-Item -ItemType Directory -Force $target | Out-Null
    $arguments = @('/a', $msi.FullName, '/qn', "TARGETDIR=$target")
    $admin = Start-Process msiexec.exe -Wait -PassThru -ArgumentList $arguments
    if ($admin.ExitCode -ne 0) { throw "msiexec /a $($msi.Name) exited with $($admin.ExitCode)" }
  }

  $signedFor = @{}
  foreach ($bundle in 'nsis', 'msi') {
    $signedFor[$bundle] = @(Get-ChildItem -Recurse -File (Join-Path $AppSignedDirectory $bundle)) + @(Get-ChildItem -File -Filter '*.exe' $AppSignedDirectory)
    foreach ($file in $signedFor[$bundle]) {
      $packed = @(Get-ChildItem -Recurse -File -Filter $file.Name (Join-Path $UnpackedDirectory $bundle))
      if ($packed.Count -ne 1) { throw "expected one $($file.Name) in the $bundle installer, found $($packed.Count)" }
      if ((Get-FileHash -LiteralPath $packed[0].FullName).Hash -ne (Get-FileHash -LiteralPath $file.FullName).Hash) { throw "the $bundle installer's $($file.Name) is not the copy SignPath signed" }
      "the $bundle installer carries the signed $($file.Name)"
    }
  }

  $nsisReason = 'NSIS plugin: third-party code extracted and loaded while setup runs; not installed'
  $wixReason = 'WiX custom action: third-party code msiexec runs while installing; not installed'
  $thirdParty = [ordered]@{
    'nsis/$PLUGINSDIR/nsDialogs.dll' = @{ reason=$nsisReason; sha256=$Pin }
    'nsis/$PLUGINSDIR/nsis_tauri_utils.dll' = @{ reason=$nsisReason; sha256='5BA143B5DB4A87D32D6E7802E033330AAE56CBCEABE0D1E3BA41948385AD4709' }
    'nsis/$PLUGINSDIR/NSISdl.dll' = @{ reason=$nsisReason; sha256='DDF40229DD9D6B268902D8DEA88C8A04AACF1AF218DD29F6DCD35BABC54AC08D' }
    'nsis/$PLUGINSDIR/StartMenu.dll' = @{ reason=$nsisReason; sha256='FE330320459637D8DD2B5D84D07925C38EC264152FFD3B1760A4D44D76536CAA' }
    'nsis/$PLUGINSDIR/System.dll' = @{ reason=$nsisReason; sha256='8B4C47C4CF5E76EC57DD5A050D5ACD832A0D532EE875D7B44F6CDAF68F90D37C' }
    'msi-streams/Binary.WixUIWixca' = @{ reason=$wixReason; signer=$Publisher; issuer=$Issuer }
  }

  $trees = [ordered]@{ nsis='nsis'; msi='msi'; 'msi-streams'='msi' }
  $problems = @(); $listed = @(); $unpackedRoot = (Resolve-Path $UnpackedDirectory).Path
  foreach ($tree in $trees.Keys) {
    $signedHashes = @($signedFor[$trees[$tree]] | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName).Hash })
    $root = Join-Path $UnpackedDirectory $tree
    $files = if (Test-Path -LiteralPath $root) { Get-ChildItem -Recurse -File $root } else { @() }
    $scanned = 0
    foreach ($file in $files) {
      if (-not (Test-PortableExecutable $file.FullName)) { continue }
      $scanned++
      $relative = [System.IO.Path]::GetRelativePath($unpackedRoot, $file.FullName).Replace('\', '/')
      if ((Get-FileHash -LiteralPath $file.FullName).Hash -in $signedHashes) { "signed by SignPath: $relative" }
      elseif ($thirdParty.Contains($relative)) {
        $listed += $relative; $identity = $thirdParty[$relative]
        if ($identity.ContainsKey('sha256')) {
          $actual = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
          if ($actual -cne $identity.sha256) { $problems += "$relative SHA-256 $actual did not match the reviewed pin $($identity.sha256)" }
          else { "third-party: $relative ($($identity.reason)); SHA-256 $actual matches pin; Tauri CLI 2.12.2; NSIS 3.11; nsis_tauri_utils 0.5.3; discovery run 38963983864" }
        } else {
          $identity = Get-Identity $file.FullName
          if ($identity.Status -ne 'Valid' -or $identity.Signer -cne $thirdParty[$relative].signer -or $identity.Issuer -cne $thirdParty[$relative].issuer) {
            $problems += "$relative must carry a valid Authenticode signature by $($thirdParty[$relative].signer) issued by $($thirdParty[$relative].issuer); found $($identity.Status), '$($identity.Signer)' issued by '$($identity.Issuer)'"
          } else { "third-party: $relative ($($thirdParty[$relative].reason)); Authenticode $($identity.Status), signed by $($identity.Signer), issued by $($identity.Issuer)" }
        }
      } else { $problems += "$relative was not signed by SignPath and is not on the third-party list" }
    }
    "unpacked/${tree}: $scanned PE files"
    if ($scanned -eq 0) { $problems += "unpacked/$tree holds no PE file, so its unpacking failed and nothing in it was checked" }
  }
  foreach ($entry in $thirdParty.Keys | Where-Object { $_ -notin $listed }) { $problems += "$entry is on the third-party list but in neither installer; remove it from release-please.yml" }
  if ($problems) { throw "the installers failed the check:`n$($problems -join "`n")" }
}

function Invoke-ExpectedFailure([string] $Name, [scriptblock] $Action, [string] $ExpectedText) {
  $message = ''
  try { & $Action } catch { $message = $_.Exception.Message }
  if (-not $message) { throw "negative case did not fail: $Name" }
  if ($message -notmatch $ExpectedText) { throw "wrong $Name failure: $message" }
  "ok: $Name -> $message"
}

if ($Mode -eq 'CliGuard') { Assert-TauriCliVersion $Lockfile; return }
if ($Mode -eq 'SignatureSet') { Test-SignPathSignatures $SignatureBaseDirectory $SignatureOutputDirectory; return }
if ($Mode -eq 'Check') {
  Assert-TauriCliVersion $Lockfile
  Test-SignPathSignatures $InstallersToSignDirectory $InstallersSignedDirectory
  Check-InstallerContents $NsDialogsPin $WixSigner $WixIssuer -SkipExtract:$SkipExtraction
  return
}
if ($Mode -eq 'Mutate') {
  switch ($MutationCase) {
    'CliLockfile' {
      Invoke-ExpectedFailure 'CLI lockfile version' {
        $lock = [System.IO.File]::ReadAllText($Lockfile)
        $pattern = "(?ms)(^  apps/desktop:\r?\n.*?^      '@tauri-apps/cli':\r?\n        specifier: [^\r\n]+\r?\n        version: )([^\r\n(]+)"
        $mutated = [regex]::Replace($lock, $pattern, '$1$2-rehearsal', 1)
        if ($mutated -ceq $lock) { throw 'CLI lockfile mutation did not apply' }
        $temp = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString() + '-pnpm-lock.yaml')
        try {
          [System.IO.File]::WriteAllText($temp, $mutated)
          Assert-TauriCliVersion $temp
        } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
      } 'Tauri CLI 2\.12\.2.*resolves 2\.12\.2-rehearsal'
    }
    'WrongSignPathIssuer' {
      Invoke-ExpectedFailure 'SignPath issuer' {
        Test-SignPathSignatures $InstallersToSignDirectory $InstallersSignedDirectory 'Unexpected CA'
      } 'issued by Unexpected CA'
    }
    'WrongPin' { Invoke-ExpectedFailure 'NSIS hash pin' { Check-InstallerContents '0000000000000000000000000000000000000000000000000000000000000000' $WixSigner $WixIssuer -SkipExtract } 'SHA-256 .* did not match the reviewed pin' }
    'WrongPublisher' { Invoke-ExpectedFailure 'WiX publisher' { Check-InstallerContents $NsDialogsPin 'NOT-WIX-TOOLSET' $WixIssuer -SkipExtract } 'by NOT-WIX-TOOLSET issued by' }
    'WrongWiXIssuer' { Invoke-ExpectedFailure 'WiX issuer' { Check-InstallerContents $NsDialogsPin $WixSigner 'Unexpected CA' -SkipExtract } 'issued by Unexpected CA' }
    'UnsignedWix' {
      Invoke-ExpectedFailure 'unsigned WiX PE' {
        $target = Join-Path $UnpackedDirectory 'msi-streams/Binary.WixUIWixca'
        $source = Join-Path $UnpackedDirectory 'nsis/$PLUGINSDIR/nsDialogs.dll'
        $backup = [System.IO.File]::ReadAllBytes($target)
        try { Copy-Item -LiteralPath $source -Destination $target -Force; Check-InstallerContents $NsDialogsPin $WixSigner $WixIssuer -SkipExtract }
        finally { [System.IO.File]::WriteAllBytes($target, $backup) }
      } 'found NotSigned'
    }
    'UnlistedPe' {
      Invoke-ExpectedFailure 'unlisted PE' {
        $source = Join-Path $UnpackedDirectory 'nsis/$PLUGINSDIR/nsDialogs.dll'
        $target = Join-Path $UnpackedDirectory 'msi-streams/Binary.UnlistedMutation'
        try { Copy-Item -LiteralPath $source -Destination $target -Force; Check-InstallerContents $NsDialogsPin $WixSigner $WixIssuer -SkipExtract }
        finally { if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force } }
      } 'not signed by SignPath and is not on the third-party list'
    }
    default { throw "Unsupported mutation: $MutationCase" }
  }
  return
}
throw "Unsupported mode: $Mode"
