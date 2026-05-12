#pragma once

#include <android/log.h>

#define LOG_TAG "Penrose"

#define LOGI(...) ((void)__android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__))
#define LOGW(...) ((void)__android_log_print(ANDROID_LOG_WARN,  LOG_TAG, __VA_ARGS__))
#define LOGE(...) ((void)__android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__))

#define VK_CHECK(call)                                                            \
    do {                                                                          \
        VkResult _r = (call);                                                     \
        if (_r != VK_SUCCESS) {                                                   \
            LOGE("%s:%d %s -> %d", __FILE__, __LINE__, #call, (int)_r);           \
            return false;                                                         \
        }                                                                         \
    } while (0)
