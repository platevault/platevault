<#
.SYNOPSIS
  Run one attempt of a Windows real-UI E2E shard and report whether it failed
  on the runner or in the suite.

.DESCRIPTION
  An unhealthy Windows runner can kill a shard before any test runs: the
  process dies during start-up with STATUS_DLL_INIT_FAILED (exit code
  -1073741502, 0xC0000142) and prints nothing (job 88420704923, upstream
  actions/partner-runner-images#169). Nextest retries cannot help, because no
  test exists yet to retry, and the red shard looks like a test failure
  (astro-plan-gl5q).

  This script runs the given command, streams its output, and classifies how
  it ended:

    passed          the command exited 0.
    runner-failure  no test started, and the command exited with
                    STATUS_DLL_INIT_FAILED, named it in its output, or printed
                    nothing at all.
    suite-failure   anything else: a test failed, or nextest said why it
                    stopped (bad filter, empty selection, broken archive).
                    That is a real failure.

  It writes `class=<value>` to GITHUB_OUTPUT, so the workflow can re-run a
  runner failure once and keep a suite failure red, and it exits with the
  command's exit code.

.PARAMETER Attempt
  1 for the first attempt, 2 for the re-run. It changes only the annotation:
  a runner failure on attempt 1 is a warning announcing the re-run; on
  attempt 2 it is an error telling the triager to re-run the job.

.PARAMETER Command
  The command and its arguments, after `--`.

.EXAMPLE
  ./scripts/e2e-shard-attempt.ps1 -Attempt 1 -- cargo nextest run --profile e2e -E 'binary(smoke)'
#>
[CmdletBinding(PositionalBinding = $false)]
param(
  [ValidateRange(1, 2)]
  [int]$Attempt = 1,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Command
)

# STATUS_DLL_INIT_FAILED as an unsigned 32-bit exit code. A PowerShell hex
# literal would parse 0xC0000142 as a negative Int32, so spell it in decimal.
$StatusDllInitFailed = [uint32]3221225794

function ConvertTo-UnsignedExitCode([int64]$ExitCode) {
  [uint32]($ExitCode -band 4294967295)
}

function Get-ShardAttemptClass {
  param(
    [Parameter(Mandatory)] [int64]$ExitCode,
    [AllowEmptyCollection()] [string[]]$Output = @()
  )
  if ($ExitCode -eq 0) {
    return [pscustomobject]@{ Class = 'passed'; Reason = 'exited 0' }
  }
  $text = ($Output -join "`n") -replace "`e\[[0-9;]*m", ''
  # nextest prints `Starting N tests across M binaries` before the first test
  # runs, so a non-zero N means the suite itself reached its tests.
  if ($text -match '(?m)^\s*Starting\s+[1-9]\d*\s+tests?\b') {
    return [pscustomobject]@{ Class = 'suite-failure'; Reason = 'the suite started its tests and failed' }
  }
  if ((ConvertTo-UnsignedExitCode $ExitCode) -eq $StatusDllInitFailed) {
    return [pscustomobject]@{ Class = 'runner-failure'; Reason = 'STATUS_DLL_INIT_FAILED before any test started' }
  }
  if ($text -match '(?i)0xC0000142|STATUS_DLL_INIT_FAILED') {
    return [pscustomobject]@{ Class = 'runner-failure'; Reason = 'its output reports STATUS_DLL_INIT_FAILED and no test started' }
  }
  if ([string]::IsNullOrWhiteSpace($text)) {
    return [pscustomobject]@{ Class = 'runner-failure'; Reason = 'no output and no test started' }
  }
  [pscustomobject]@{ Class = 'suite-failure'; Reason = 'no test started and nextest says why above' }
}

function Write-ShardClass([string]$Class) {
  if ($env:GITHUB_OUTPUT) {
    Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value "class=$Class" -Encoding utf8
  }
}

# Dot-sourcing loads the functions above for scripts/tests/e2e-shard-attempt.tests.ps1.
if ($MyInvocation.InvocationName -eq '.') { return }

if (-not $Command) {
  throw 'usage: e2e-shard-attempt.ps1 [-Attempt 1|2] -- <command> [args...]'
}
if (-not (Get-Command -Name $Command[0] -CommandType Application -ErrorAction SilentlyContinue)) {
  Write-Output "::error title=E2E shard did not run::'$($Command[0])' is not an executable on PATH."
  Write-ShardClass 'suite-failure'
  exit 1
}

# Native stderr lines arrive as error records under 2>&1; they are output to
# stream and classify, not reasons to stop.
$ErrorActionPreference = 'Continue'
$output = [System.Collections.Generic.List[string]]::new()
$global:LASTEXITCODE = 0
& $Command[0] @($Command | Select-Object -Skip 1) 2>&1 | ForEach-Object {
  $line = "$_"
  Write-Output $line
  $output.Add($line)
}
$exitCode = [int64]$LASTEXITCODE

$result = Get-ShardAttemptClass -ExitCode $exitCode -Output $output
Write-ShardClass $result.Class

$shown = '{0} (0x{1:X8})' -f $exitCode, (ConvertTo-UnsignedExitCode $exitCode)
# A comma ends a workflow-command property, so annotation titles carry none.
switch ($result.Class) {
  'runner-failure' {
    if ($Attempt -eq 1) {
      Write-Output "::warning title=Runner failure (not a test failure)::Shard attempt 1 exited ${shown}: $($result.Reason). The runner could not start the suite; re-running the shard once."
    } else {
      Write-Output "::error title=Runner failure (not a test failure)::Shard attempt 2 exited ${shown}: $($result.Reason), and attempt 1 also failed before any test ran. The runner is broken, not the code under test: re-run the job."
    }
  }
  'suite-failure' {
    Write-Output "::error title=E2E suite failure::Shard attempt $Attempt exited ${shown}: $($result.Reason). This is a real failure: read the nextest output above."
  }
}
exit [int]$exitCode
