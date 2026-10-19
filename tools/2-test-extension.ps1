# 2-test-extension.ps1 — Super Video Downloader
# ─────────────────────────────────────────────────────────────────────────
# Deja la extensión lista para probar de un solo comando:
#
#   1. Abre Chrome en un perfil de pruebas AISLADO en %TEMP% (no toca tu
#      perfil ni tus sesiones habituales).
#   2. Activa "Developer mode" automáticamente (Chrome ya no acepta
#      extensiones descomprimidas sin esto).
#   3. Carga Super Video Downloader con el método oficial del DevTools Protocol
#      (Extensions.loadUnpacked) — el reemplazo moderno de --load-extension,
#      que Chrome empezó a ignorar si Developer mode está apagado.
#   4. Abre un video MP4 de enlace directo (o la URL que le pases) para que
#      pruebes la detección/descarga de una vez. OJO: sitios como YouTube o
#      Netflix usan streaming adaptativo (blob:/MSE) que esta extensión
#      detecta pero marca como "no descargable" a propósito — para probar
#      un caso realmente descargable usa una URL de video directo (.mp4).
#
# Uso:
#   powershell -File tools\2-test-extension.ps1
#   powershell -File tools\2-test-extension.ps1 https://sitio-con-video-directo.example/video.mp4

param(
    [string]$Url = "https://media.w3.org/2010/05/sintel/trailer.mp4"
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir = Split-Path -Parent $PSScriptRoot
$ProfileDir = Join-Path $env:TEMP 'super-video-downloader-test-profile'
$Port = 9333

if (-not (Test-Path (Join-Path $RootDir 'manifest.json'))) {
    Write-Error "No se encontró manifest.json en $RootDir"
}

# ── 1. Localizar Chrome/Edge ─────────────────────────────────────────────
$BrowserCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$Browser = $BrowserCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $Browser) {
    Write-Error "No se encontró Chrome/Chromium/Edge instalado en el sistema."
}

# ── 2. Localizar Python ──────────────────────────────────────────────────
$Python = $null
foreach ($bin in @('python', 'python3', 'py')) {
    $cmd = Get-Command $bin -ErrorAction SilentlyContinue
    if ($cmd) {
        try {
            & $cmd.Source --version *>$null
            if ($LASTEXITCODE -eq 0) { $Python = $cmd.Source; break }
        } catch {}
    }
}

if (-not $Python) {
    Write-Error "Se necesita Python para automatizar la carga (no se encontró en PATH)."
}

# ── 3. Perfil siempre fresco ──────────────────────────────────────────────
# Mata solo los procesos de Chrome/Edge que usan ESTE perfil de pruebas
# (nunca todo chrome.exe, para no cerrar el navegador normal del usuario).
Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*super-video-downloader-test-profile*" } |
    ForEach-Object {
        try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
    }
Start-Sleep -Milliseconds 500

if (Test-Path $ProfileDir) {
    Remove-Item -Recurse -Force $ProfileDir -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

Write-Output "Navegador: $Browser"
Write-Output "Extensión: $RootDir"
Write-Output "Perfil de pruebas: $ProfileDir (aislado, no afecta tu perfil normal)"
Write-Output ""

Start-Process -FilePath $Browser -ArgumentList @(
    "--user-data-dir=$ProfileDir",
    "--remote-debugging-port=$Port",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank"
) | Out-Null

Write-Output "Chrome abriéndose... activando Developer mode e instalando la extensión..."

$LoaderScript = Join-Path $PSScriptRoot '_cdp_loader.py'
$env:PYTHONIOENCODING = 'utf-8'
& $Python $LoaderScript $Port $RootDir $Url
if ($LASTEXITCODE -eq 0) {
    Write-Output ""
    Write-Output "Listo. Super Video Downloader está instalada y activa en esta ventana de Chrome."
    Write-Output "Abre el popup (icono de la barra de extensiones) para ver el video detectado y descargarlo."
} else {
    Write-Output ""
    Write-Output "No se pudo automatizar la instalación (ver error arriba)."
    Write-Output "Puedes hacerlo a mano: en la ventana que se abrió, ve a chrome://extensions,"
    Write-Output "activa 'Developer mode' y usa 'Cargar descomprimida' seleccionando:"
    Write-Output "  $RootDir"
    exit 1
}
