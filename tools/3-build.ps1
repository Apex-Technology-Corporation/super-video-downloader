# 3-build.ps1 — Super Video Downloader
# ─────────────────────────────────────────────────────────────────────────
# Empaqueta la extensión en un .zip listo para subir a la Chrome Web Store
# (o para distribuir manualmente). Solo incluye los archivos que la
# extensión necesita en tiempo de ejecución, valida que manifest.json sea
# JSON válido, que todos los iconos declarados existan, y preserva la
# estructura de carpetas dentro del zip.
#
# Uso:
#   powershell -File tools\3-build.ps1
#
# Salida:
#   dist\super-video-downloader-v<version>.zip

$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $PSScriptRoot
$DistDir = Join-Path $RootDir 'dist'
$Manifest = Join-Path $RootDir 'manifest.json'

Set-Location $RootDir

# ── 1. Validar manifest.json ────────────────────────────────────────────
if (-not (Test-Path $Manifest)) {
    Write-Error "No se encontró manifest.json en $RootDir"
}

try {
    $ManifestObj = Get-Content $Manifest -Raw | ConvertFrom-Json
} catch {
    Write-Error "manifest.json no es un JSON válido. Corrígelo antes de compilar."
}

$Version = $ManifestObj.version
Write-Output "Versión detectada: $Version"

# La Chrome Web Store rechaza el .zip si "description" supera 132
# caracteres — validarlo acá evita descubrirlo recién al subir el archivo.
$DescLen = ($ManifestObj.description | Measure-Object -Character).Characters
if ($DescLen -gt 132) {
    Write-Error "manifest.json: 'description' tiene $DescLen caracteres (máx. 132 para la Chrome Web Store)."
}

# ── 2. Archivos que forman parte del paquete final ──────────────────────
$Files = @(
    'manifest.json',
    'background.js',
    'content.js',
    'scripts/utils.js',
    'scripts/storage.js',
    'scripts/detector.js',
    'scripts/downloader.js',
    'scripts/hls-parser.js',
    'offscreen/offscreen.html',
    'offscreen/offscreen.js',
    'vendor/ffmpeg/ffmpeg.js',
    'vendor/ffmpeg/814.ffmpeg.js',
    'vendor/ffmpeg/ffmpeg-core.js',
    'vendor/ffmpeg/ffmpeg-core.wasm',
    'popup/popup.html',
    'popup/popup.css',
    'popup/popup.js',
    'options/options.html',
    'options/options.css',
    'options/options.js',
    'assets/icons/icon16.png',
    'assets/icons/icon32.png',
    'assets/icons/icon48.png',
    'assets/icons/icon128.png'
)

$Missing = $false
foreach ($f in $Files) {
    if (-not (Test-Path $f)) {
        Write-Output "Falta un archivo requerido: $f"
        $Missing = $true
    }
}
if ($Missing) {
    Write-Error "Compilación cancelada: hay archivos requeridos ausentes."
}

# ── 3. Validar sintaxis de los .js si Node está disponible ──────────────
if (Get-Command node -ErrorAction SilentlyContinue) {
    $JsFiles = @(
        'background.js', 'content.js',
        'scripts/utils.js', 'scripts/storage.js', 'scripts/detector.js',
        'scripts/downloader.js', 'scripts/hls-parser.js',
        'offscreen/offscreen.js', 'popup/popup.js', 'options/options.js'
    )
    foreach ($js in $JsFiles) {
        node --check $js
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Error de sintaxis en $js. Corrígelo antes de compilar."
        }
    }
    Write-Output "Sintaxis de los .js OK"
}

# ── 4. Empaquetar (preservando la estructura de carpetas) ────────────────
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null
$ZipPath = Join-Path $DistDir "super-video-downloader-v$Version.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Zip = [System.IO.Compression.ZipFile]::Open($ZipPath, 'Create')
foreach ($f in $Files) {
    $Full = (Resolve-Path $f).Path
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Zip, $Full, $f, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
}
$Zip.Dispose()

Write-Output ""
Write-Output "======================================================"
Write-Output " Paquete generado: $ZipPath"
Write-Output "======================================================"
$SizeMB = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
Write-Output "Tamaño: $SizeMB MB"
Write-Output ""
Write-Output "Contenido:"
[System.IO.Compression.ZipFile]::OpenRead($ZipPath).Entries | ForEach-Object { Write-Output "  $($_.FullName)" }
Write-Output ""
Write-Output "Listo para subir a https://chrome.google.com/webstore/devconsole"
