#!/usr/bin/env bash
# Prueba el APK en el emulador de Android (CI, D-101): lo instala, lo abre con la autoprueba
# del motor y comprueba en el registro que el motor funciona y que la interfaz ha cargado.
# Uso: bash scripts/probar-android-emulador.sh release/CRM-Mellow-<versión>-android-x86_64.apk
set -eu
APK=$1
LOG=$(mktemp)
adb install -r "$APK"
adb logcat -c
adb shell am start -n cc.yellowmellow.crm/.MainActivity --ez autoprueba true
for _ in $(seq 1 90); do
  adb logcat -d > "$LOG"
  if grep -q "interfaz conectada" "$LOG" || grep -q "AUTOPRUEBA FALLIDA" "$LOG"; then break; fi
  sleep 2
done
adb logcat -d > "$LOG"
grep -E "CRM-Mellow|AndroidRuntime" "$LOG" | tail -60 || true
grep -q "AUTOPRUEBA CORRECTA" "$LOG" || { echo "La autoprueba del motor no ha pasado"; exit 1; }
grep -q "interfaz conectada" "$LOG" || { echo "La interfaz no ha llegado a conectarse al motor"; exit 1; }
if grep -q "FATAL EXCEPTION" "$LOG"; then echo "La app se ha cerrado con un error"; exit 1; fi
echo "APK: autoprueba correcta e interfaz conectada"
