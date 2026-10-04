// Arranca Node (nodejs-mobile) con los argumentos que pasa la actividad y manda su salida
// al registro de Android. Basado en el puente de nodejs-mobile-react-native (MIT).
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <fcntl.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <dlfcn.h>
#include <unwind.h>

#include "node.h"

static const char *TAG = "CRM-Mellow-Node";

// --- Diagnóstico: quién termina el proceso -----------------------------------------------
// En una app de Android, exit() cierra todo el proceso y los demás hilos caen al usar lo ya
// destruido. Esta función se registra con atexit al cargar el puente (antes que el motor) y,
// si algo llama a exit(), apunta la pila de llamadas en el registro y en el archivo de errores.

struct Frames {
    void *pcs[48];
    int count;
};

static _Unwind_Reason_Code collect(struct _Unwind_Context *ctx, void *arg) {
    auto *f = static_cast<Frames *>(arg);
    const uintptr_t pc = _Unwind_GetIP(ctx);
    if (pc && f->count < 48) f->pcs[f->count++] = reinterpret_cast<void *>(pc);
    return f->count < 48 ? _URC_NO_REASON : _URC_END_OF_STACK;
}

static void log_line(const char *line) {
    __android_log_write(ANDROID_LOG_ERROR, "CRM-Mellow-Salida", line);
    // También al archivo de errores del motor (salida de errores, fd 2).
    dprintf(STDERR_FILENO, "%s\n", line);
}

static void on_exit_handler() {
    char line[512];
    snprintf(line, sizeof line, "exit() llamado en el hilo %d; pila:", gettid());
    log_line(line);
    Frames f{};
    _Unwind_Backtrace(collect, &f);
    for (int i = 0; i < f.count; i++) {
        Dl_info info{};
        if (dladdr(f.pcs[i], &info) && info.dli_fname) {
            const char *lib = strrchr(info.dli_fname, '/');
            snprintf(line, sizeof line, "  #%02d %s %s+%#lx", i, lib ? lib + 1 : info.dli_fname,
                     info.dli_sname ? info.dli_sname : "?",
                     static_cast<unsigned long>(reinterpret_cast<uintptr_t>(f.pcs[i]) -
                                                reinterpret_cast<uintptr_t>(
                                                    info.dli_saddr ? info.dli_saddr : info.dli_fbase)));
        } else {
            snprintf(line, sizeof line, "  #%02d %p", i, f.pcs[i]);
        }
        log_line(line);
    }
}

extern "C" JNIEXPORT jint JNI_OnLoad(JavaVM *, void *) {
    atexit(on_exit_handler);
    return JNI_VERSION_1_6;
}
static int pipe_out[2];

static void *forward(void *arg) {
    const int fd = *static_cast<int *>(arg);
    char buf[2048];
    ssize_t n;
    while ((n = read(fd, buf, sizeof buf - 1)) > 0) {
        if (buf[n - 1] == '\n') --n;
        buf[n] = 0;
        __android_log_write(ANDROID_LOG_INFO, TAG, buf);
    }
    return nullptr;
}

// La salida estándar va al registro de Android (por un hilo que la lee). La de errores va a
// un archivo, escrita en el momento: si Node falla al arrancar y cierra el proceso, su
// mensaje queda ahí y la app lo pasa al registro la próxima vez que se abre.
static void redirect_output(const char *stderr_path) {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(pipe_out) == -1) return;
    dup2(pipe_out[1], STDOUT_FILENO);
    pthread_t t1;
    if (pthread_create(&t1, nullptr, forward, &pipe_out[0]) == 0) pthread_detach(t1);
    const int fd = open(stderr_path, O_WRONLY | O_CREAT | O_TRUNC | O_APPEND | O_CLOEXEC, 0600);
    if (fd >= 0) {
        dup2(fd, STDERR_FILENO);
        close(fd);
    }
}

extern "C" JNIEXPORT jint JNICALL
Java_cc_yellowmellow_crm_NodeRunner_startNode(JNIEnv *env, jclass, jobjectArray arguments,
                                              jstring stderrPath) {
    const jsize count = env->GetArrayLength(arguments);
    std::vector<std::string> args;
    size_t total = 0;
    for (jsize i = 0; i < count; i++) {
        auto s = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        const char *c = env->GetStringUTFChars(s, nullptr);
        args.emplace_back(c);
        total += args.back().size() + 1;
        env->ReleaseStringUTFChars(s, c);
        env->DeleteLocalRef(s);
    }
    // libuv necesita todos los argumentos seguidos en memoria.
    char *buffer = static_cast<char *>(calloc(total, 1));
    std::vector<char *> argv;
    char *pos = buffer;
    for (const auto &a : args) {
        memcpy(pos, a.c_str(), a.size());
        argv.push_back(pos);
        pos += a.size() + 1;
    }
    const char *path = env->GetStringUTFChars(stderrPath, nullptr);
    redirect_output(path);
    env->ReleaseStringUTFChars(stderrPath, path);
    return node::Start(static_cast<int>(argv.size()), argv.data());
}
