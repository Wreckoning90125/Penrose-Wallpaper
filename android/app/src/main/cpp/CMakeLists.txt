cmake_minimum_required(VERSION 3.22.1)
project(penrose LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# -fno-rtti dropped intentionally: ImNodeFlow uses typeid(T) on pin
# template parameters for connection-filter compatibility checks. typeid
# on static (template) types is fine without RTTI in clang, but the
# editor's own internals also lean on type_info pointer equality which
# needs proper type info emission. We keep -fno-exceptions because none
# of the deps throw on hot paths.
add_compile_options(
    -Wall -Wextra -Wpedantic
    -Wno-unused-parameter
    -fno-exceptions
    -ffast-math
)

if(CMAKE_BUILD_TYPE STREQUAL "Release" OR CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
    add_compile_options(-O3 -fvisibility=hidden -fvisibility-inlines-hidden)
endif()

# -----------------------------------------------------------------------------
# Third-party dependencies. FetchContent pulls Dear ImGui + ImNodeFlow at
# configure time and stores them in ${CMAKE_BINARY_DIR}/_deps/, keeping the
# repo lean and locking precise commits. Network access is needed at configure
# time but only the first time — subsequent builds reuse the cached copies.
# -----------------------------------------------------------------------------
include(FetchContent)
FetchContent_Declare(
    imgui
    GIT_REPOSITORY https://github.com/ocornut/imgui.git
    GIT_TAG        8936b58fe26e8c3da834b8f60b06511d537b4c63 # v1.92.8
)
FetchContent_Declare(
    imnodeflow
    GIT_REPOSITORY https://github.com/Fattorino/ImNodeFlow.git
    GIT_TAG        e4cb0989c302e0ae324ff03ed1b3f0d2851ee630
)
FetchContent_GetProperties(imgui)
if(NOT imgui_POPULATED)
    FetchContent_Populate(imgui)
endif()
FetchContent_GetProperties(imnodeflow)
if(NOT imnodeflow_POPULATED)
    FetchContent_Populate(imnodeflow)
endif()

# Patch ImNodeFlow: older copies of thedmd's imgui_extra_math.inl define
# operator*(float, ImVec2&) unconditionally, while current ImGui defines the
# same operator inside its IMGUI_DEFINE_MATH_OPERATORS block (which ImNodeFlow.h
# force-enables). Two competing inline definitions trip clang's ODR check. Use
# the same version guard carried by current ImNodeFlow, and leave already-guarded
# sources untouched.
set(_INF_INL "${imnodeflow_SOURCE_DIR}/src/imgui_extra_math.inl")
file(READ "${_INF_INL}" _INF_INL_TEXT)
string(FIND "${_INF_INL_TEXT}" "PENROSE_OPSTAR_GATED" _inf_patched)
set(_INF_OPSTAR_OLD "inline ImVec2 operator*(const float lhs, const ImVec2& rhs)\n{\n    return ImVec2(lhs * rhs.x, lhs * rhs.y);\n}")
string(FIND "${_INF_INL_TEXT}" "# if IMGUI_VERSION_NUM < 19268\n${_INF_OPSTAR_OLD}" _inf_guarded)
string(FIND "${_INF_INL_TEXT}" "${_INF_OPSTAR_OLD}" _inf_opstar_old)
if(_inf_patched EQUAL -1 AND _inf_guarded EQUAL -1 AND _inf_opstar_old GREATER_EQUAL 0)
    string(REPLACE "${_INF_OPSTAR_OLD}"
        "// PENROSE_OPSTAR_GATED: IMGUI_VERSION_NUM >= 19268 already defines this under IMGUI_DEFINE_MATH_OPERATORS.\n# if IMGUI_VERSION_NUM < 19268\n${_INF_OPSTAR_OLD}\n# endif"
        _INF_INL_TEXT "${_INF_INL_TEXT}"
    )
    file(WRITE "${_INF_INL}" "${_INF_INL_TEXT}")
elseif(_inf_patched EQUAL -1 AND _inf_guarded EQUAL -1 AND _inf_opstar_old EQUAL -1)
    message(FATAL_ERROR "ImNodeFlow imgui_extra_math.inl did not match the expected operator* patch shape")
endif()

# Patch ImNodeFlow: widen the link hit-test radius. Link::update() tests
# the cursor against the connection bezier with a 2.5-unit collider —
# fine for a mouse, far too thin to tap on a touchscreen, so a user can
# never select a link in order to delete it. Widen it to 10 units
# (~12px at the editor's default zoom) so links are tappable. Idempotent
# across rebuilds; a harmless no-op if upstream ever changes the literal.
set(_INF_CPP "${imnodeflow_SOURCE_DIR}/src/ImNodeFlow.cpp")
file(READ "${_INF_CPP}" _INF_CPP_TEXT)
string(FIND "${_INF_CPP_TEXT}" "start, end, 10.0)" _inf_collider_patched)
if(_inf_collider_patched EQUAL -1)
    string(REPLACE
        "smart_bezier_collider(ImGui::GetMousePos(), start, end, 2.5)"
        "smart_bezier_collider(ImGui::GetMousePos(), start, end, 10.0)"
        _INF_CPP_TEXT "${_INF_CPP_TEXT}")
    file(WRITE "${_INF_CPP}" "${_INF_CPP_TEXT}")
endif()

# Patch ImNodeFlow: tint a selected link red on the base bezier, not just
# its outline. The library draws an outline on top of a pin-coloured base
# bezier when m_selected — fine on a desktop, far too subtle on a phone
# where the user has tapped a link expressly to delete it. Switching the
# base smart_bezier call to red on m_selected gives the whole link an
# unmistakable red accent the second it is selected. Idempotent across
# rebuilds via the PENROSE_LINK_RED marker.
file(READ "${_INF_CPP}" _INF_CPP_TEXT)
string(FIND "${_INF_CPP_TEXT}" "PENROSE_LINK_RED" _inf_redlink_patched)
if(_inf_redlink_patched EQUAL -1)
    string(REPLACE
        "smart_bezier(start, end, m_left->getStyle()->color, thickness);"
        "smart_bezier(start, end, m_selected ? IM_COL32(225, 65, 65, 235) /* PENROSE_LINK_RED */ : m_left->getStyle()->color, thickness);"
        _INF_CPP_TEXT "${_INF_CPP_TEXT}")
    file(WRITE "${_INF_CPP}" "${_INF_CPP_TEXT}")
endif()

# Patch ImNodeFlow: the inner viewport wrapper should not be independently
# resizable. Android users resize the outer GraphEditorHost window; keeping the
# inner invisible wrapper resizable leaves hidden edge hit targets over the
# canvas and can turn a pan/link gesture into an ImGui window resize.
set(_INF_CTX "${imnodeflow_SOURCE_DIR}/src/context_wrapper.h")
file(READ "${_INF_CTX}" _INF_CTX_TEXT)
string(FIND "${_INF_CTX_TEXT}" "PENROSE_INNER_NORESIZE" _inf_inner_noresize)
if(_inf_inner_noresize EQUAL -1)
    string(REPLACE
        "ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoMove\n                                                | ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse"
        "ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoMove\n                                                | ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse\n                                                | ImGuiWindowFlags_NoResize /* PENROSE_INNER_NORESIZE */"
        _INF_CTX_TEXT "${_INF_CTX_TEXT}")
    string(FIND "${_INF_CTX_TEXT}" "PENROSE_INNER_NORESIZE" _inf_inner_noresize_after)
    if(_inf_inner_noresize_after EQUAL -1)
        message(FATAL_ERROR "ImNodeFlow context_wrapper.h did not match the expected inner-window flags patch shape")
    endif()
    file(WRITE "${_INF_CTX}" "${_INF_CTX_TEXT}")
endif()

add_library(penrose SHARED
    # JNI entrypoints
    jni_bridge.cpp
    graph/graph_jni.cpp

    # Native signal handler — dumps a tagged backtrace to logcat AND to
    # filesDir/crash.log on SIGSEGV/SIGABRT/SIGBUS/SIGILL/SIGFPE before
    # re-raising for debuggerd. See crash_handler.h.
    crash_handler.cpp

    # Renderer (split for readability — Vulkan setup, mesh generation,
    # and the per-frame draw live in separate translation units).
    renderer/renderer.cpp
    renderer/renderer_vulkan.cpp
    renderer/renderer_geometry.cpp

    # Audio analyser (FFT + bands + beat envelope)
    audio/audio_analyzer.cpp

    # OKLCH ↔ sRGB / DisplayP3 colour math
    color/color.cpp

    # Penrose / Chair tile generator + classifier
    tiling/penrose.cpp

    # Modulation graph + node editor UI + persistence
    graph/graph.cpp
    graph/graph_ui.cpp

    # ImGui host (context + Vulkan backend + touch event ring)
    ui/imgui_host.cpp

    # Dear ImGui core + Vulkan + Android backends
    ${imgui_SOURCE_DIR}/imgui.cpp
    ${imgui_SOURCE_DIR}/imgui_draw.cpp
    ${imgui_SOURCE_DIR}/imgui_widgets.cpp
    ${imgui_SOURCE_DIR}/imgui_tables.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_vulkan.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_android.cpp

    # ImNodeFlow — single TU; .inl files are #included transitively.
    ${imnodeflow_SOURCE_DIR}/src/ImNodeFlow.cpp
)

# CMAKE_CURRENT_SOURCE_DIR is the cpp/ root, so every .cpp can include
# its peers by per-subdir path: e.g. `#include "audio/audio_analyzer.h"`.
# No additional include dirs needed per subfolder — keeping the include
# tree shallow makes grepping easier.
target_include_directories(penrose PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${imgui_SOURCE_DIR}
    ${imgui_SOURCE_DIR}/backends
    ${imnodeflow_SOURCE_DIR}/include
    ${imnodeflow_SOURCE_DIR}/src
)

target_compile_definitions(penrose PRIVATE
    IMGUI_DEFINE_MATH_OPERATORS  # required by ImNodeFlow
)

# Silence pragma noise inside the vendored sources without affecting ours.
set_source_files_properties(
    ${imgui_SOURCE_DIR}/imgui.cpp
    ${imgui_SOURCE_DIR}/imgui_draw.cpp
    ${imgui_SOURCE_DIR}/imgui_widgets.cpp
    ${imgui_SOURCE_DIR}/imgui_tables.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_vulkan.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_android.cpp
    ${imnodeflow_SOURCE_DIR}/src/ImNodeFlow.cpp
    PROPERTIES COMPILE_FLAGS
        "-Wno-unused-function -Wno-unused-variable -Wno-pedantic -Wno-deprecated-declarations -Wno-extra-semi -Wno-unused-but-set-variable"
)

# clang-tidy - opt-in static analysis on the penrose target.
# Enabled with -DPENROSE_TIDY=ON through Gradle -PpenroseTidy=true. The wrapper
# skips FetchContent _deps so CI logs and the ratchet cover checked-in project
# sources without vendored ImGui/ImNodeFlow diagnostics.
option(PENROSE_TIDY "Run clang-tidy on the penrose target" OFF)
if(PENROSE_TIDY)
    find_program(CLANG_TIDY_EXE
        NAMES clang-tidy clang-tidy-19 clang-tidy-18 clang-tidy-17
        PATHS ENV PATH)
    find_package(Python3 COMPONENTS Interpreter)
    if(CLANG_TIDY_EXE AND Python3_Interpreter_FOUND)
        set(PENROSE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../../../..")
        set(PENROSE_CLANG_TIDY_FILTER "${PENROSE_ROOT}/tools/clang_tidy_project_filter.py")
        message(STATUS "Enabling clang-tidy: ${CLANG_TIDY_EXE}")
        set_target_properties(penrose PROPERTIES
            CXX_CLANG_TIDY
            "${Python3_EXECUTABLE};${PENROSE_CLANG_TIDY_FILTER};${CLANG_TIDY_EXE};-checks=bugprone-*,concurrency-*,cppcoreguidelines-pro-type-static-cast-downcast,performance-*,readability-misleading-indentation,-bugprone-easily-swappable-parameters,-bugprone-narrowing-conversions")
    elseif(CLANG_TIDY_EXE)
        message(FATAL_ERROR "PENROSE_TIDY=ON requires Python3 for the clang-tidy project-source filter")
    else()
        message(FATAL_ERROR "PENROSE_TIDY=ON but clang-tidy was not found on PATH")
    endif()
endif()

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
