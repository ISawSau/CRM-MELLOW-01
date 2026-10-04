#!/usr/bin/env bash
# Prueba el APK en el emulador de Android (CI, D-101): lo instala, lo abre con la autoprueba
# del motor y comprueba en el registro que el motor funciona y que la interfaz ha cargado.
# Deja el registro completo en registro-android/ (el CI lo guarda si algo falla).
# Uso: bash scripts/probar-android-emulador.sh release/CRM-Mellow-<versión>-android-x86_64.apk
set -u
# Sin «set -e»: si adb falla a mitad (la app se cae), el diagnóstico tiene que salir igual.
APK=$1
OUT=registro-android
mkdir -p "$OUT"
LOG=$OUT/logcat.txt
# Con root (las imágenes google_apis del emulador lo permiten) se pueden leer los informes de
# cierre de Android, con la pila de llamadas nativa de cada hilo.
adb root > /dev/null 2>&1 && sleep 3 && adb wait-for-device

# Espera a que el emulador responda de verdad: tras arrancar o tras «adb root» (que reinicia
# adbd) puede salir un momento como «offline» aunque ya haya terminado de arrancar.
ready() {
  for _ in $(seq 1 60); do
    if [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = "1" ] \
      && adb shell pm path android > /dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}
ready || echo "(el emulador no responde todavía; se intenta igualmente)"
adb shell 'rm -f /data/tombstones/*' > /dev/null 2>&1 || true
installed=0
for attempt in 1 2 3; do
  if adb install -r "$APK"; then
    installed=1
    break
  fi
  echo "Intento $attempt de instalar el APK fallido; se reintenta"
  sleep 5
  adb wait-for-device
  ready || true
done
[ "$installed" = 1 ] || { echo "No se ha podido instalar el APK"; exit 1; }
adb logcat -c || true
adb logcat -b crash -c || true
adb shell am start -n cc.yellowmellow.crm/.MainActivity --ez autoprueba true || true
for _ in $(seq 1 90); do
  adb logcat -d > "$LOG" 2>&1 || echo "(adb logcat ha fallado: $?)"
  if grep -q "interfaz conectada" "$LOG" || grep -q "AUTOPRUEBA FALLIDA" "$LOG" \
    || grep -q "no se ha podido arrancar" "$LOG" || grep -q "Fatal signal" "$LOG"; then
    sleep 2
    break
  fi
  sleep 2
done
adb logcat -d -v threadtime > "$LOG" 2>&1 || echo "(adb logcat ha fallado: $?)"
adb logcat -d -b crash -v threadtime > "$OUT/crash.txt" || true
PID=$(adb shell pidof cc.yellowmellow.crm || true)
if ! grep -q "interfaz conectada" "$LOG"; then
  # Si no ha llegado al final, se reabre: la app vuelca al registro lo que el motor apuntó.
  adb shell am force-stop cc.yellowmellow.crm || true
  adb shell am start -n cc.yellowmellow.crm/.MainActivity || true
  sleep 10
  echo "--- Arranque anterior (apuntado por el motor) ---"
  adb logcat -d -s CRM-Mellow-Anterior || true
fi
echo "--- Registro de la app (pid ${PID:-ninguno}) ---"
grep -E "CRM-Mellow|CRM Mellow|AndroidRuntime|DEBUG|libc|chromium" "$LOG" | tail -150 || true
echo "--- Cierres ---"
tail -120 "$OUT/crash.txt" || true
TOMB=$(adb shell 'ls -t /data/tombstones/ 2>/dev/null | grep -v pb | head -1' | tr -d '\r')
if [ -n "$TOMB" ]; then
  adb shell "cat /data/tombstones/$TOMB" > "$OUT/tombstone.txt" 2>/dev/null || true
  echo "--- Informe de cierre ($TOMB): hilo que cae ---"
  head -90 "$OUT/tombstone.txt"
  echo "--- Hilos del motor (node, arranque, canal) ---"
  awk '/^--- --- ---/{show=0} /name: (node|arranque|canal-nativo|main)/{show=1} show' "$OUT/tombstone.txt" | head -160
fi
grep -q "AUTOPRUEBA CORRECTA" "$LOG" || { echo "La autoprueba del motor no ha pasado"; exit 1; }
grep -q "interfaz conectada" "$LOG" || { echo "La interfaz no ha llegado a conectarse al motor"; exit 1; }
if grep -q "FATAL EXCEPTION\|Fatal signal" "$LOG"; then echo "La app se ha cerrado con un error"; exit 1; fi
echo "APK: autoprueba correcta e interfaz conectada"
