#!/usr/bin/env bash
# Compila la app de Android (D-101):
#   1. trae nodejs-mobile (Node 18 para Android) de npm,
#   2. compila el módulo nativo de SQLite cifrado para el móvil y el emulador,
#   3. compila el motor y la interfaz (npm run build:mobile),
#   4. genera los APK con Gradle (uno por arquitectura).
#
# Necesita Node 22+, JDK 17+, Gradle 9.6+ y el Android SDK (ANDROID_HOME) con el NDK
# 28.2.13676358 y CMake 3.31.6. El APK de release se firma si ANDROID_KEYSTORE_FILE (y sus
# contraseñas) están definidas; si no, con la clave de depuración.
#
# Uso: bash scripts/compilar-android.sh [release|debug]
# Resultado: release/CRM-Mellow-<versión>-android-arm64.apk (y -x86_64 para el emulador).
set -euo pipefail
cd "$(dirname "$0")/.."

TIPO=${1:-release}
NODEJS_MOBILE=18.20.4
NODEJS_MOBILE_GYP=0.4.0
NDK_VERSION=28.2.13676358
API=24
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
[ -n "$SDK" ] || { echo "Falta ANDROID_HOME (carpeta del Android SDK)"; exit 1; }
NDK=$SDK/ndk/$NDK_VERSION
[ -d "$NDK" ] || { echo "Falta el NDK $NDK_VERSION en $SDK/ndk"; exit 1; }
TC=$NDK/toolchains/llvm/prebuilt/linux-x86_64
GRADLE=${GRADLE:-gradle}
WORK=$PWD/android/.nodejs-mobile
LIBNODE=$PWD/android/app/libnode
VERSION=$(node -p "require('./package.json').version")

echo "== 1/4 nodejs-mobile $NODEJS_MOBILE"
PKG=$WORK/$NODEJS_MOBILE/package
if [ ! -f "$PKG/android/libnode/bin/arm64-v8a/libnode.so" ]; then
  mkdir -p "$WORK/$NODEJS_MOBILE"
  # El paquete de React Native trae libnode.so ya compilado y las cabeceras. npm comprueba
  # la huella del archivo con la del registro.
  (cd "$WORK/$NODEJS_MOBILE" && npm pack "nodejs-mobile-react-native@$NODEJS_MOBILE" --silent >/dev/null \
    && tar xzf "nodejs-mobile-react-native-$NODEJS_MOBILE.tgz" && rm -f ./*.tgz)
fi
if [ ! -f "$WORK/gyp/node_modules/nodejs-mobile-gyp/bin/node-gyp.js" ]; then
  npm install --prefix "$WORK/gyp" --no-save --no-audit --no-fund "nodejs-mobile-gyp@$NODEJS_MOBILE_GYP" >/dev/null
fi
mkdir -p "$LIBNODE/include"
rm -rf "$LIBNODE/include/node"
cp -r "$PKG/android/libnode/include/node" "$LIBNODE/include/node"

echo "== 2/4 SQLite cifrado para Android"
(cd mobile && npm ci --ignore-scripts --no-audit --no-fund >/dev/null)
SQLITE_VERSION=$(node -p "require('./mobile/node_modules/better-sqlite3/package.json').version")
for ABI in arm64-v8a x86_64; do
  case $ABI in
    arm64-v8a) ARCH=arm64; PREFIX=aarch64-linux-android ;;
    x86_64) ARCH=x64; PREFIX=x86_64-linux-android ;;
  esac
  OUT=$LIBNODE/jniLibs/$ABI
  mkdir -p "$OUT"
  cp "$PKG/android/libnode/bin/$ABI/libnode.so" "$OUT/libnode.so"
  CACHE=$WORK/sqlite-$SQLITE_VERSION-$ABI.so
  if [ ! -f "$CACHE" ]; then
    BUILD=$WORK/build-$ABI
    rm -rf "$BUILD"
    mkdir -p "$BUILD"
    cp -r mobile/node_modules/better-sqlite3 "$BUILD/"
    (
      cd "$BUILD/better-sqlite3"
      rm -rf build prebuilds
      env npm_config_node_engine=v8 npm_config_nodedir="$PKG/android/libnode" \
        npm_config_arch=$ARCH npm_config_platform=android npm_config_format=make-android \
        AR="$TC/bin/llvm-ar" RANLIB="$TC/bin/llvm-ranlib" \
        CC="$TC/bin/$PREFIX$API-clang" CXX="$TC/bin/$PREFIX$API-clang++" LINK="$TC/bin/$PREFIX$API-clang++" \
        GYP_DEFINES="target_arch=$ARCH v8_target_arch=$ARCH android_target_arch=$ARCH host_os=linux OS=android" \
        node "$WORK/gyp/node_modules/nodejs-mobile-gyp/bin/node-gyp.js" rebuild --release >"$BUILD/log.txt" 2>&1 \
        || { tail -40 "$BUILD/log.txt"; exit 1; }
    )
    "$TC/bin/llvm-strip" --strip-unneeded -o "$CACHE" "$BUILD/better-sqlite3/build/Release/better_sqlite3.node"
  fi
  cp "$CACHE" "$OUT/libbetter_sqlite3.so"
done

echo "== 3/4 Motor e interfaz"
npm run build:mobile >/dev/null
ASSETS=android/app/src/main/assets/nodejs-project
rm -rf "$ASSETS"
mkdir -p "$ASSETS/licencias"
cp -r out/mobile/backend out/mobile/www "$ASSETS/"
cp "$PKG/LICENSE" "$ASSETS/licencias/nodejs-mobile-MIT.txt"
cp mobile/node_modules/better-sqlite3/LICENSE "$ASSETS/licencias/better-sqlite3-MIT.txt"

echo "== 4/4 APK ($TIPO)"
if [ "$TIPO" = release ]; then TAREA=assembleRelease; else TAREA=assembleDebug; fi
"$GRADLE" -p android --no-daemon -q "$TAREA"
mkdir -p release
for ABI in arm64-v8a x86_64; do
  NOMBRE=$([ "$ABI" = arm64-v8a ] && echo arm64 || echo x86_64)
  cp "android/app/build/outputs/apk/$TIPO/app-$ABI-$TIPO.apk" "release/CRM-Mellow-$VERSION-android-$NOMBRE.apk"
done
ls -la release/*.apk
