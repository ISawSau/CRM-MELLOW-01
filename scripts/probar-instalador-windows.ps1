#Requires -Version 5.1
<#
.SYNOPSIS
    Prueba el instalador de Windows de principio a fin, como lo usaría una persona.

.DESCRIPTION
    1. Instala CRM Mellow en modo silencioso (/S), para el usuario actual.
    2. Comprueba que existen el ejecutable y los accesos directos del escritorio y
       del menú Inicio.
    3. Abre la app instalada con --autoprueba (crea, bloquea y desbloquea una
       bóveda temporal cifrada).
    4. Desinstala en modo silencioso y comprueba que no queda ni el programa ni
       los accesos directos.

    Uso (lo ejecuta el CI tras generar el instalador):
        powershell -ExecutionPolicy Bypass -File scripts\probar-instalador-windows.ps1 release\CRM-Mellow-0.1.0-windows-x64-instalador.exe
#>
param(
    [Parameter(Mandatory = $true)][string]$Instalador
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Paso([string]$Texto) { Write-Host "==> $Texto" -ForegroundColor Yellow }
function Stop-ConError([string]$Texto) { Write-Host "MAL $Texto" -ForegroundColor Red; exit 1 }

function Wait-Hasta([scriptblock]$Condicion, [int]$Segundos, [string]$Que) {
    $limite = (Get-Date).AddSeconds($Segundos)
    while (-not (& $Condicion)) {
        if ((Get-Date) -gt $limite) { Stop-ConError "tiempo agotado esperando: $Que" }
        Start-Sleep -Milliseconds 500
    }
}

$Instalador = (Resolve-Path $Instalador).Path
$escritorio = [Environment]::GetFolderPath('Desktop')
$menuInicio = Join-Path ([Environment]::GetFolderPath('Programs')) 'CRM Mellow.lnk'
$accesoEscritorio = Join-Path $escritorio 'CRM Mellow.lnk'
$programas = Join-Path $env:LOCALAPPDATA 'Programs'

function Find-Exe {
    if (-not (Test-Path $programas)) { return $null }
    Get-ChildItem -Path $programas -Filter 'crm-mellow.exe' -Recurse -Depth 2 -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

Write-Paso "Instalando en modo silencioso: $(Split-Path -Leaf $Instalador)"
$p = Start-Process -FilePath $Instalador -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { Stop-ConError "el instalador terminó con código $($p.ExitCode)" }
Wait-Hasta { $null -ne (Find-Exe) } 60 'el ejecutable instalado'
$exe = (Find-Exe).FullName
$carpeta = Split-Path -Parent $exe
Write-Host "ok  instalado en $carpeta"

Write-Paso 'Comprobando accesos directos'
Wait-Hasta { Test-Path $accesoEscritorio } 30 'el acceso directo del escritorio'
Write-Host "ok  escritorio: $accesoEscritorio"
Wait-Hasta { Test-Path $menuInicio } 30 'el acceso directo del menú Inicio'
Write-Host "ok  menú Inicio: $menuInicio"

Write-Paso 'Abriendo la app instalada con --autoprueba'
$salida = Join-Path $env:TEMP 'crm-autoprueba.txt'
$p = Start-Process -FilePath $exe -ArgumentList '--autoprueba' -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput $salida
Get-Content $salida
if ($p.ExitCode -ne 0) { Stop-ConError "la autoprueba terminó con código $($p.ExitCode)" }

Write-Paso 'Desinstalando en modo silencioso'
$desinstalador = Get-ChildItem -Path $carpeta -Filter 'Uninstall*.exe' | Select-Object -First 1
if (-not $desinstalador) { Stop-ConError "no se encuentra el desinstalador en $carpeta" }
# El desinstalador de NSIS se copia a una carpeta temporal y vuelve enseguida: se
# espera a que desaparezca el programa.
Start-Process -FilePath $desinstalador.FullName -ArgumentList '/S' -Wait | Out-Null
Wait-Hasta { -not (Test-Path $exe) } 120 'que se borre el ejecutable'
Wait-Hasta { -not (Test-Path $accesoEscritorio) } 30 'que se borre el acceso del escritorio'
Wait-Hasta { -not (Test-Path $menuInicio) } 30 'que se borre el acceso del menú Inicio'
Write-Host 'ok  desinstalado sin dejar el programa ni los accesos directos'

Write-Host 'PRUEBA DEL INSTALADOR CORRECTA' -ForegroundColor Green
