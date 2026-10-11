$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$localDir = Join-Path $projectRoot '.local'
$pgData = Join-Path $localDir 'postgres'
$pgCtl = 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe'
$node = (Get-Command node -ErrorAction Stop).Source

foreach ($path in @(
  $pgCtl,
  (Join-Path $pgData 'PG_VERSION'),
  (Join-Path $localDir 'bin\mailpit\mailpit.exe'),
  (Join-Path $localDir 'bin\livekit\livekit-server.exe'),
  (Join-Path $localDir 'livekit.yaml'),
  (Join-Path $projectRoot 'backend\.env'),
  (Join-Path $projectRoot 'backend\dist\main.js'),
  (Join-Path $projectRoot 'frontend\node_modules\vite\bin\vite.js')
)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Не найден $path. Сначала выполните первоначальную настройку проекта." }
}

$logs = Join-Path $localDir 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null

& $pgCtl -D $pgData status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  & $pgCtl -D $pgData -o '-p 55432 -h 127.0.0.1' -l (Join-Path $localDir 'postgres.log') start
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL не запустилась' }
}

function Start-LocalProcess($name, $executable, $arguments, $workingDir, $expectedProcess) {
  $pidFile = Join-Path $localDir "$name.pid"
  if (Test-Path -LiteralPath $pidFile) {
    $savedId = [int](Get-Content -LiteralPath $pidFile -Raw)
    $existing = Get-Process -Id $savedId -ErrorAction SilentlyContinue
    if ($existing -and $existing.ProcessName -eq $expectedProcess) {
      Write-Output "$name уже работает (PID $savedId)"
      return
    }
  }
  $started = Start-Process -FilePath $executable -ArgumentList $arguments -WorkingDirectory $workingDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs "$name.out.log") -RedirectStandardError (Join-Path $logs "$name.err.log") -PassThru
  Set-Content -LiteralPath $pidFile -Value $started.Id
  Write-Output "$name запущен (PID $($started.Id))"
}

Start-LocalProcess 'mailpit' (Join-Path $localDir 'bin\mailpit\mailpit.exe') @('--database', "`"$(Join-Path $localDir 'mailpit.db')`"", '--listen', '127.0.0.1:8025', '--smtp', '127.0.0.1:1025') $projectRoot 'mailpit'
Start-LocalProcess 'livekit' (Join-Path $localDir 'bin\livekit\livekit-server.exe') @('--config', "`"$(Join-Path $localDir 'livekit.yaml')`"", '--bind', '127.0.0.1', '--node-ip', '127.0.0.1') $projectRoot 'livekit-server'
Start-LocalProcess 'backend' $node @('--env-file=.env', 'dist/main.js') (Join-Path $projectRoot 'backend') 'node'
Start-LocalProcess 'frontend' $node @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173') (Join-Path $projectRoot 'frontend') 'node'

Write-Output 'Сайт: http://127.0.0.1:5173'
Write-Output 'Почта: http://127.0.0.1:8025'
Write-Output 'После запуска подождите до минуты, пока API загрузится.'
