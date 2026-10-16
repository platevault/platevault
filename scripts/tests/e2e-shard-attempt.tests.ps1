<#
.SYNOPSIS
  Tests for scripts/e2e-shard-attempt.ps1 (astro-plan-gl5q).

.DESCRIPTION
  Plain PowerShell, no test framework. Run with:
    pwsh -NoProfile -File scripts/tests/e2e-shard-attempt.tests.ps1
  Exits non-zero if any case fails. The real STATUS_DLL_INIT_FAILED exit code
  only exists on Windows, so the end-to-end case for it runs there; elsewhere
  the classifier still sees that exit code directly.
#>
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..' 'e2e-shard-attempt.ps1'
. $script

$failures = 0
function Assert-Equal($Name, $Expected, $Actual) {
  if ($Expected -eq $Actual) {
    Write-Output "ok: $Name"
  } else {
    Write-Output "FAIL: $Name -- expected '$Expected', got '$Actual'"
    $script:failures++
  }
}

# --- Classifier --------------------------------------------------------------

$startedAndFailed = @(
  '────────────',
  '    Starting 5 tests across 3 binaries (25 tests skipped)',
  '        FAIL [  12.345s] (1/5) e2e_tests::smoke all_top_level_screens_load',
  '     Summary [  60.000s] 5 tests run: 4 passed, 1 failed, 25 skipped'
)

$cases = @(
  @{ Name = 'gl5q signature: -1073741502 and no output is a runner failure'; Code = -1073741502; Output = @(); Class = 'runner-failure' },
  @{ Name = 'STATUS_DLL_INIT_FAILED as an unsigned exit code is a runner failure'; Code = 3221225794; Output = @(); Class = 'runner-failure' },
  @{ Name = 'any non-zero exit with no output is a runner failure'; Code = 1; Output = @('', '   '); Class = 'runner-failure' },
  @{ Name = 'a test binary dying at init while nextest lists tests is a runner failure'; Code = 101
     Output = @('error: creating test list failed', '  command `e2e-tests\smoke.exe --list` exited with code 0xc0000142: STATUS_DLL_INIT_FAILED'); Class = 'runner-failure' },
  @{ Name = 'a failing journey is a suite failure'; Code = 100; Output = $startedAndFailed; Class = 'suite-failure' },
  @{ Name = 'a coloured Starting banner still counts as tests started'; Code = 100
     Output = @("    `e[1;32mStarting`e[0m `e[1m5`e[0m tests across `e[1m3`e[0m binaries"); Class = 'suite-failure' },
  @{ Name = 'STATUS_DLL_INIT_FAILED after tests started is a suite failure'; Code = -1073741502; Output = $startedAndFailed; Class = 'suite-failure' },
  @{ Name = 'an empty selection (--no-tests=fail) is a suite failure'; Code = 4
     Output = @('    Starting 0 tests across 1 binary (30 tests skipped)', 'error: no tests to run'); Class = 'suite-failure' },
  @{ Name = 'a bad filter expression is a suite failure'; Code = 96; Output = @('error: failed to parse filterset'); Class = 'suite-failure' },
  @{ Name = 'exit 0 passes'; Code = 0; Output = @(); Class = 'passed' }
)
foreach ($case in $cases) {
  $result = Get-ShardAttemptClass -ExitCode $case.Code -Output $case.Output
  Assert-Equal $case.Name $case.Class $result.Class
}

# --- End to end: the script around a fake command ----------------------------

$pwsh = [System.Environment]::ProcessPath
$work = Join-Path ([System.IO.Path]::GetTempPath()) "e2e-shard-attempt-tests-$PID"
New-Item -ItemType Directory -Force -Path $work | Out-Null

function Invoke-Attempt([int]$Attempt, [string]$FakeBody) {
  $fake = Join-Path $work 'fake.ps1'
  Set-Content -LiteralPath $fake -Value $FakeBody -Encoding utf8
  $outputFile = Join-Path $work 'github_output'
  Set-Content -LiteralPath $outputFile -Value '' -Encoding utf8
  $previous = $env:GITHUB_OUTPUT
  $env:GITHUB_OUTPUT = $outputFile
  try {
    $lines = & $script -Attempt $Attempt -- $pwsh -NoProfile -NonInteractive -File $fake
    $code = $LASTEXITCODE
  } finally {
    $env:GITHUB_OUTPUT = $previous
  }
  $class = (Get-Content -LiteralPath $outputFile | Where-Object { $_ -like 'class=*' }) -replace '^class=', ''
  [pscustomobject]@{ Code = $code; Class = "$class"; Text = ($lines -join "`n") }
}

$r = Invoke-Attempt 1 'exit 3'
Assert-Equal 'silent death: class' 'runner-failure' $r.Class
Assert-Equal 'silent death: exit code kept' 3 $r.Code
Assert-Equal 'silent death on attempt 1: re-run warning' $true ($r.Text -match '::warning title=Runner failure, not a test failure::Shard attempt 1 .*re-running the shard once')

$r = Invoke-Attempt 2 'exit 3'
Assert-Equal 'silent death on attempt 2: error tells the triager to re-run the job' $true ($r.Text -match '::error title=Runner failure, not a test failure::Shard attempt 2 .*re-run the job')

$r = Invoke-Attempt 1 "'    Starting 2 tests across 1 binary'; '        FAIL [   1.000s] (1/2) e2e_tests::smoke x'; exit 100"
Assert-Equal 'failing journey: class' 'suite-failure' $r.Class
Assert-Equal 'failing journey: exit code kept' 100 $r.Code
Assert-Equal 'failing journey: suite-failure error' $true ($r.Text -match '::error title=E2E suite failure::')
Assert-Equal 'failing journey: nextest output streamed' $true ($r.Text -match 'FAIL \[   1.000s\]')

$r = Invoke-Attempt 1 "[Console]::Error.WriteLine('error: no tests to run'); exit 4"
Assert-Equal 'nextest error on stderr: captured and classed as suite failure' 'suite-failure' $r.Class

$r = Invoke-Attempt 1 "'    Starting 2 tests across 1 binary'; exit 0"
Assert-Equal 'passing shard: class' 'passed' $r.Class
Assert-Equal 'passing shard: exit 0' 0 $r.Code

if ($IsWindows) {
  $r = Invoke-Attempt 1 'exit -1073741502'
  Assert-Equal 'Windows: real STATUS_DLL_INIT_FAILED exit is a runner failure' 'runner-failure' $r.Class
  Assert-Equal 'Windows: real STATUS_DLL_INIT_FAILED exit code kept' -1073741502 $r.Code
  Assert-Equal 'Windows: annotation names 0xC0000142' $true ($r.Text -match '-1073741502 \(0xC0000142\)')
} else {
  Write-Output 'skip: real STATUS_DLL_INIT_FAILED exit code (Windows only)'
}

$missing = & $script -- definitely-not-a-real-command-gl5q
Assert-Equal 'missing executable: exit 1' 1 $LASTEXITCODE
Assert-Equal 'missing executable: says so' $true (($missing -join "`n") -match 'is not an executable on PATH')

Remove-Item -Recurse -Force -LiteralPath $work
if ($failures -gt 0) {
  Write-Output "$failures case(s) failed"
  exit 1
}
Write-Output 'all cases passed'
