// Arranca Node (nodejs-mobile) con los argumentos que pasa la actividad y manda su salida
// al registro de Android. Basado en el puente de nodejs-mobile-react-native (MIT).
#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "node.h"

static const char *TAG = "CRM-Mellow-Node";
static int pipe_out[2];
static int pipe_err[2];

static void *forward(void *arg) {
    const int fd = *static_cast<int *>(arg);
    const int prio = fd == pipe_err[0] ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO;
    char buf[2048];
    ssize_t n;
    while ((n = read(fd, buf, sizeof buf - 1)) > 0) {
        if (buf[n - 1] == '\n') --n;
        buf[n] = 0;
        __android_log_write(prio, TAG, buf);
    }
    return nullptr;
}

static void redirect_output() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(pipe_out) == -1 || pipe(pipe_err) == -1) return;
    dup2(pipe_out[1], STDOUT_FILENO);
    dup2(pipe_err[1], STDERR_FILENO);
    pthread_t t1, t2;
    if (pthread_create(&t1, nullptr, forward, &pipe_out[0]) == 0) pthread_detach(t1);
    if (pthread_create(&t2, nullptr, forward, &pipe_err[0]) == 0) pthread_detach(t2);
}

extern "C" JNIEXPORT jint JNICALL
Java_cc_yellowmellow_crm_NodeRunner_startNode(JNIEnv *env, jclass, jobjectArray arguments) {
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
    redirect_output();
    return node::Start(static_cast<int>(argv.size()), argv.data());
}
