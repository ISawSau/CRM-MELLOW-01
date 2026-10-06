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

# --- Segundo plano (D-118) ---------------------------------------------------------------
# Lo que pasa al conectar con Google: el usuario está en el navegador (la app en segundo
# plano) y Google vuelve a una dirección local del motor. El motor (sonda de la autoprueba,
# src/mobile/background-probe.ts) espera en un puerto; aquí se manda la app al fondo, se
# espera más de los 10 s tras los que Android congela las apps en segundo plano y se llama a
# esa dirección como haría el navegador. Primero sin el servicio en primer plano (así estaba
# la app hasta la 0.16.8) y después con él.
PROBE=$OUT/sonda.txt
: > "$PROBE"
NC=$(adb shell 'command -v nc || command -v toybox' 2> /dev/null | tr -d '\r' | head -1)
case "$NC" in
  */toybox) NC="$NC nc" ;;
esac
probe() {
  local mode=$1 port="" out
  for _ in $(seq 1 60); do
    port=$(adb logcat -d 2> /dev/null | grep -o "sonda $mode: esperando en el puerto [0-9]*" \
      | tail -1 | grep -o '[0-9]*$')
    [ -n "$port" ] && break
    sleep 2
  done
  if [ -z "$port" ]; then
    echo "sonda $mode: no ha empezado" | tee -a "$PROBE"
    return
  fi
  adb shell input keyevent KEYCODE_HOME
  sleep 25
  if [ "$mode" = con-servicio ]; then
    adb shell dumpsys activity services cc.yellowmellow.crm 2> /dev/null > "$OUT/servicios.txt"
    if grep -q "BusyService" "$OUT/servicios.txt" && grep -q "isForeground=true" "$OUT/servicios.txt"; then
      echo "sonda $mode: servicio en primer plano activo" | tee -a "$PROBE"
    else
      echo "sonda $mode: el servicio en primer plano no aparece" | tee -a "$PROBE"
    fi
  fi
  out=$(adb shell "printf 'GET /?code=sonda HTTP/1.0\\r\\n\\r\\n' | timeout 10 $NC 127.0.0.1 $port" 2>&1 | tr -d '\r')
  if echo "$out" | grep -q "sonda ok"; then
    echo "sonda $mode: el motor contesta con la app en segundo plano" | tee -a "$PROBE"
  else
    echo "sonda $mode: el motor NO contesta con la app en segundo plano (${out:-sin respuesta})" \
      | tee -a "$PROBE"
  fi
  # El motor comprueba la red con la app todavía en segundo plano.
  for _ in $(seq 1 15); do
    adb logcat -d 2> /dev/null | grep -q "sonda $mode: .*HTTPS con Google" && break
    sleep 2
  done
  adb shell am start -n cc.yellowmellow.crm/.MainActivity > /dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    adb logcat -d 2> /dev/null | grep -q "sonda $mode: .*HTTPS con Google" && break
    sleep 2
  done
  adb logcat -d 2> /dev/null | grep -o "sonda $mode: .*" | tee -a "$PROBE"
}
if grep -q "interfaz conectada" "$LOG"; then
  echo "--- Segundo plano (navegador encima, más de 10 s) ---"
  probe sin-servicio
  probe con-servicio
fi

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
echo "--- Red (HTTPS con Google desde el motor) ---"
grep -E "HTTPS con Google" "$LOG" | tail -2 || true
echo "--- Segundo plano (resultado) ---"
cat "$PROBE" 2> /dev/null || true
grep -q "AUTOPRUEBA CORRECTA" "$LOG" || { echo "La autoprueba del motor no ha pasado"; exit 1; }
# Con el servicio en primer plano el motor tiene que contestar en segundo plano y, si el
# emulador tiene red (la autoprueba llegó a Google), tener red también ahí.
grep -q "sonda con-servicio: el motor contesta con la app en segundo plano" "$PROBE" \
  || { echo "Con el servicio en primer plano el motor no contesta en segundo plano"; exit 1; }
if grep -q "autoprueba: ok  HTTPS con Google" "$LOG" \
  && ! grep -q "sonda con-servicio: ok  HTTPS con Google" "$PROBE"; then
  echo "Con el servicio en primer plano el motor no tiene red en segundo plano"
  exit 1
fi
grep -q "interfaz conectada" "$LOG" || { echo "La interfaz no ha llegado a conectarse al motor"; exit 1; }
if grep -q "FATAL EXCEPTION\|Fatal signal" "$LOG"; then echo "La app se ha cerrado con un error"; exit 1; fi
echo "APK: autoprueba correcta e interfaz conectada"
