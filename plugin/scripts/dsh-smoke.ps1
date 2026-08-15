param(
  [string]$Tgz = "dsh-subscribe-0.3.1.tgz"
)

$ErrorActionPreference = 'Stop'

$tgz = (Resolve-Path $Tgz).Path
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-subscribe-smoke-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$env:DSH_HOME = Join-Path $tmp 'dsh-home'
$p = $null

try {
  Write-Output '== install packed plugin into a fresh DSH profile =='
  pnpm dlx @deepseek-ai/dsh plugin --profile web add $tgz
  if ($LASTEXITCODE -ne 0) { throw "dsh plugin add failed with exit code $LASTEXITCODE" }

  Write-Output '== verify the plugin row exists in the composed config =='
  $cfg = pnpm dlx @deepseek-ai/dsh --profile web --dump-config
  if ($LASTEXITCODE -ne 0) { throw 'dsh --dump-config failed' }
  if (($cfg -join "`n") -notmatch 'dsh-subscribe') { throw 'dsh-subscribe not found in dump-config' }
  Write-Output 'PASS plugin appears in DSH config'

  Write-Output '== boot dsh web with the plugin loaded (bounded retry, 30s cap) =='
  $pnpm = (Get-Command pnpm).Source
  $stdout = Join-Path $tmp 'web.out'
  $stderr = Join-Path $tmp 'web.err'
  $p = Start-Process -FilePath $pnpm -ArgumentList @('dlx', '@deepseek-ai/dsh', 'web', '--port', '4099') -WorkingDirectory $tmp -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr

  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if ($p.HasExited) { break }
    try {
      $res = Invoke-WebRequest -Uri 'http://127.0.0.1:4099' -TimeoutSec 2 -UseBasicParsing
      if ($res.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    Get-Content $stdout -ErrorAction SilentlyContinue
    Get-Content $stderr -ErrorAction SilentlyContinue
    throw 'dsh web did not become ready within 30s'
  }

  Write-Output 'PASS dsh web booted with the plugin loaded (HTTP 200)'

  Write-Output '== in-harness market API: registry route =='
  $reg = Invoke-RestMethod -Uri 'http://127.0.0.1:4099/dsh-subscribe/registry' -TimeoutSec 15
  if ($reg.count -lt 500) { throw "registry route returned too few plugins: $($reg.count)" }
  Write-Output "PASS registry route: $($reg.count) plugins, $($reg.verified) verified"

  Write-Output '== in-harness market API: UI page =='
  $ui = Invoke-WebRequest -Uri 'http://127.0.0.1:4099/dsh-subscribe/' -TimeoutSec 15 -UseBasicParsing
  if ($ui.Content -notmatch 'dsh-subscribe') { throw 'market UI page missing dsh-subscribe' }
  Write-Output 'PASS market UI page served'

  Write-Output '== in-harness market API: one-click install (real dsh CLI) =='
  $spec = 'file:' + $tgz.Replace('\', '/')
  $body = @{ spec = $spec } | ConvertTo-Json
  $install = Invoke-RestMethod -Uri 'http://127.0.0.1:4099/dsh-subscribe/install' -Method Post -Headers @{ Origin = 'http://127.0.0.1:4099' } -ContentType 'application/json' -Body $body -TimeoutSec 300
  if (-not $install.ok) {
    Write-Output $install
    throw 'one-click install route did not report ok'
  }
  Write-Output "PASS one-click install executed: exit=$($install.exitCode) added=$($install.added -join ',')"

  Write-Output '== in-harness market API: installed list contains dsh-subscribe =='
  $inst = Invoke-RestMethod -Uri 'http://127.0.0.1:4099/dsh-subscribe/installed' -TimeoutSec 15
  if (-not ($inst.installed.PSObject.Properties.Name -contains 'dsh-subscribe')) { throw 'installed list missing dsh-subscribe' }
  Write-Output 'PASS installed list verified'
} finally {
  if ($p -and -not $p.HasExited) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
