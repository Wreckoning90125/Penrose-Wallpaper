cmake_minimum_required(VERSION 3.22.1)
project(penrose LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_compile_options(
    -Wall -Wextra -Wpedantic
    -Wno-unused-parameter
    -fno-exceptions -fno-rtti
    -ffast-math
)

if(CMAKE_BUILD_TYPE STREQUAL "Release" OR CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
    add_compile_options(-O3 -fvisibility=hidden -fvisibility-inlines-hidden)
endif()

add_library(penrose SHARED
    jni_bridge.cpp
    renderer.cpp
    penrose.cpp
    color.cpp
)

target_include_directories(penrose PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

# Vulkan + Android NDK system libs.
find_library(log-lib log)
find_library(android-lib android)
find_library(vulkan-lib vulkan)

target_link_libraries(penrose PRIVATE
    ${log-lib}
    ${android-lib}
    ${vulkan-lib}
)

# Make sure Vulkan headers know we are targeting Android. Do not define
# VK_NO_PROTOTYPES at all — even =0 disables prototype declarations because
# the headers test with #if !defined(VK_NO_PROTOTYPES).
target_compile_definitions(penrose PRIVATE
    VK_USE_PLATFORM_ANDROID_KHR=1
)
