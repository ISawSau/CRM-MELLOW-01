#Requires -Version 5.1
<#
.SYNOPSIS
    Instala todo lo necesario para desarrollar y probar CRM Mellow en Windows.

.DESCRIPTION
    Uso, desde la carpeta del repositorio (en PowerShell):

        powershell -ExecutionPolicy Bypass -File scripts\instalar-windows.ps1

    "-ExecutionPolicy Bypass" solo afecta a esta ejecución; no cambia la
    configuración de seguridad de Windows.

    Qué hace:
      1. Instala con winget (el gestor oficial de Microsoft) Git y Node.js LTS si
         no los tienes. Si ya tienes Node.js 22.12 o superior, no lo toca.
      2. Instala las dependencias del proyecto con "npm ci" (versiones exactas del
         package-lock.json).
      3. Ejecuta los tests para comprobar que todo funciona.

.PARAMETER SinPreguntas
    Acepta automáticamente los acuerdos de winget (para automatizar).
#>
param(
    [switch]$SinPreguntas
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$NodeMin = [version]'22.12.0'

function Write-Paso([string]$Texto) {
    Write-Host ''
    Write-Host "==> $Texto" -ForegroundColor Yellow
}

function Stop-ConError([string]$Texto) {
    Write-Host "Error: $Texto" -ForegroundColor Red
    exit 1
}

function Update-RutaDelSistema {
    # winget instala en el PATH del sistema; se recarga para esta misma ventana.
    $maquina = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $usuario = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$maquina;$usuario"
}

function Get-VersionNode {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { return $null }
    $texto = (& node --version).Trim().TrimStart('v')
    try { return [version]$texto } catch { return $null }
}

function Install-ConWinget([string]$Id, [string]$Nombre) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Stop-ConError "no se encuentra winget. Instala 'Instalador de aplicación' (App Installer) desde Microsoft Store y vuelve a ejecutar el script."
    }
    Write-Host "Instalando $Nombre con winget ($Id)..."
    $argumentos = @('install', '--id', $Id, '--exact', '--source', 'winget')
    if ($SinPreguntas) {
        $argumentos += @('--accept-package-agreements', '--accept-source-agreements', '--silent')
    }
    & winget @argumentos
    if ($LASTEXITCODE -ne 0) { Stop-ConError "winget no pudo instalar $Nombre (código $LASTEXITCODE)." }
    Update-RutaDelSistema
}

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
if (-not (Test-Path (Join-Path $raiz 'package.json'))) {
    Stop-ConError 'no se encuentra package.json; ejecuta el script desde el repositorio.'
}

Write-Paso 'Comprobando Git y Node.js'
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host "Git ya instalado: $((& git --version).Trim())"
} else {
    Install-ConWinget 'Git.Git' 'Git'
}

$versionNode = Get-VersionNode
if ($versionNode -and $versionNode -ge $NodeMin) {
    Write-Host "Node.js v$versionNode ya instalado: se mantiene."
} else {
    Install-ConWinget 'OpenJS.NodeJS.LTS' 'Node.js LTS'
    $versionNode = Get-VersionNode
    if (-not $versionNode -or $versionNode -lt $NodeMin) {
        Stop-ConError "Node.js sigue sin estar disponible o es anterior a $NodeMin. Cierra y abre PowerShell y vuelve a ejecutar el script."
    }
}
Write-Host "Node.js v$versionNode, npm $((& npm --version).Trim())"

Write-Paso 'Instalando dependencias del proyecto (npm ci)'
& npm ci
if ($LASTEXITCODE -ne 0) { Stop-ConError "npm ci ha fallado (código $LASTEXITCODE)." }

Write-Paso 'Descargando Electron (se verifica con las sumas SHA-256 del propio paquete)'
& node node_modules\electron\install.js
if ($LASTEXITCODE -ne 0) { Stop-ConError "no se pudo descargar Electron (código $LASTEXITCODE)." }

Write-Paso 'Descargando FFmpeg para el vídeo (se verifica con su huella SHA-256)'
& node scripts\descargar-ffmpeg.mjs
if ($LASTEXITCODE -ne 0) { Stop-ConError "no se pudo descargar FFmpeg (código $LASTEXITCODE)." }

Write-Paso 'Comprobando que todo funciona (tests unitarios)'
& npm test
if ($LASTEXITCODE -ne 0) { Stop-ConError "los tests han fallado (código $LASTEXITCODE)." }

Write-Paso 'Listo'
Write-Host @'
Comandos útiles (desde esta carpeta):
  npm run dev           abrir la app en modo desarrollo
  npm test              tests unitarios
  npm run test:e2e      tests de la interfaz (abre la app)
  npm run dist:win      generar el instalador en release\
'@
