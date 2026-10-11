$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$localDir = Join-Path $projectRoot '.local'

foreach ($entry in @(
  @{ Name = 'frontend'; Process = 'node' },
  @{ Name = 'backend'; Process = 'node' },
  @{ Name = 'livekit'; Process = 'livekit-server' },
  @{ Name = 'mailpit'; Process = 'mailpit' }
)) {
  $pidFile = Join-Path $localDir "$($entry.Name).pid"
  if (-not (Test-Path -LiteralPath $pidFile)) { continue }
  $savedId = [int](Get-Content -LiteralPath $pidFile -Raw)
  $running = Get-Process -Id $savedId -ErrorAction SilentlyContinue
  if ($running -and $running.ProcessName -eq $entry.Process) {
    Stop-Process -Id $savedId
    Write-Output "$($entry.Name) остановлен"
  }
  Remove-Item -LiteralPath $pidFile
}

$pgCtl = 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe'
$pgData = Join-Path $localDir 'postgres'
if ((Test-Path -LiteralPath $pgCtl) -and (Test-Path -LiteralPath (Join-Path $pgData 'PG_VERSION'))) {
  & $pgCtl -D $pgData status 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    & $pgCtl -D $pgData stop
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL не остановилась' }
  }
}
