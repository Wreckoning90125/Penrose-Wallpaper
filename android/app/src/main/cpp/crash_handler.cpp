// Native crash handler. See crash_handler.h for the rationale.
//
// Implementation notes:
//   - The handler runs on the signal stack (sigaltstack) so a corrupted
//     primary stack can't kill the handler too. 64 KiB is plenty for
//     formatting + the unwind walk.
//   - We use _Unwind_Backtrace from libgcc/libunwind (it's part of the
//     Bionic runtime — no extra link). dladdr() resolves PC values to
//     symbol names where the dynamic table has them.
//   - async-signal-safe rules: we use write() / __android_log_write()
//     for emission. snprintf is technically not on the AS-safe list but
//     Bionic's is reentrant enough for the simple format strings we use
//     here. Avoid malloc, std::string, FILE*.
//   - After dumping, we restore the default disposition and re-raise so
//     the platform tombstone machinery (debuggerd) sees the signal.

#include "crash_handler.h"

#include <android/log.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <pthread.h>
#include <signal.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>
#include <unwind.h>

#include <atomic>

namespace penrose::crash {

namespace {

constexpr const char* kTag        = "PenroseCrash";
constexpr int         kMaxFrames  = 64;
constexpr size_t      kAltStackSz = static_cast<size_t>(64) * 1024;

// Single-shot install guard.
std::atomic<bool> installed_{false};

// Owned by the handler — stack memory for sigaltstack.
char altStack_[kAltStackSz];

// Path to the on-disk crash log. Copied from install()'s filesDirAbsolute
// so we never read the caller's memory inside the signal handler.
char crashLogPath_[512];
bool haveCrashLog_ = false;

struct UnwindState {
    void** frames;
    int    count;
    int    capacity;
};

_Unwind_Reason_Code captureFrame(struct _Unwind_Context* ctx, void* arg) {
    UnwindState* s = static_cast<UnwindState*>(arg);
    uintptr_t pc = _Unwind_GetIP(ctx);
    if (pc == 0) return _URC_END_OF_STACK;
    if (s->count >= s->capacity) return _URC_END_OF_STACK;
    s->frames[s->count++] = reinterpret_cast<void*>(pc); // NOLINT(performance-no-int-to-ptr)
    return _URC_NO_REASON;
}

const char* signalName(int sig) {
    switch (sig) {
        case SIGSEGV: return "SIGSEGV";
        case SIGBUS:  return "SIGBUS";
        case SIGABRT: return "SIGABRT";
        case SIGILL:  return "SIGILL";
        case SIGFPE:  return "SIGFPE";
        case SIGTRAP: return "SIGTRAP";
        default:      return "SIG?";
    }
}

// Emit a line to both logcat and the on-disk crash log (if set up).
void emit(const char* line) {
    __android_log_write(ANDROID_LOG_FATAL, kTag, line);
    if (haveCrashLog_) {
        int fd = ::open(crashLogPath_,
                        O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC,
                        S_IRUSR | S_IWUSR);
        if (fd >= 0) {
            ::write(fd, line, strlen(line));
            ::write(fd, "\n", 1);
            ::close(fd);
        }
    }
}

void handler(int sig, siginfo_t* info, void* /*ucontext*/) {
    char buf[512];

    // Header — signal name + faulting address + tid.
    snprintf(buf, sizeof(buf),
             "==== Penrose native crash: %s (signo=%d, code=%d, addr=%p, tid=%d) ====",
             signalName(sig), sig, info ? info->si_code : 0,
             info ? info->si_addr : nullptr, gettid());
    emit(buf);

    // Timestamp.
    time_t now = time(nullptr);
    struct tm tm_buf;
    if (gmtime_r(&now, &tm_buf)) {
        strftime(buf, sizeof(buf), "  at %Y-%m-%d %H:%M:%S UTC", &tm_buf);
        emit(buf);
    }

    // Walk the stack.
    void* frames[kMaxFrames];
    UnwindState st{ frames, 0, kMaxFrames };
    _Unwind_Backtrace(&captureFrame, &st);

    for (int i = 0; i < st.count; ++i) {
        Dl_info dli{};
        const char* sym = "??";
        const char* lib = "??";
        uintptr_t off  = 0;
        if (dladdr(frames[i], &dli)) {
            if (dli.dli_sname) sym = dli.dli_sname;
            if (dli.dli_fname) lib = dli.dli_fname;
            if (dli.dli_saddr) {
                off = reinterpret_cast<uintptr_t>(frames[i]) // NOLINT(performance-no-int-to-ptr)
                    - reinterpret_cast<uintptr_t>(dli.dli_saddr); // NOLINT(performance-no-int-to-ptr)
            }
        }
        snprintf(buf, sizeof(buf), "  #%02d  pc %p  %s+0x%lx  (%s)",
                 i, frames[i], sym, (unsigned long)off, lib);
        emit(buf);
    }
    emit("==== end Penrose crash dump ====");

    // Re-raise with the default handler so debuggerd writes a tombstone
    // and the system can take whatever action (e.g. unsetting a crashy
    // live wallpaper) it normally would.
    struct sigaction dfl{};
    dfl.sa_handler = SIG_DFL;
    sigemptyset(&dfl.sa_mask);
    sigaction(sig, &dfl, nullptr);
    raise(sig);
}

} // namespace

void install(const char* filesDirAbsolute) {
    bool expected = false;
    if (!installed_.compare_exchange_strong(expected, true)) return;

    if (filesDirAbsolute && filesDirAbsolute[0]) {
        snprintf(crashLogPath_, sizeof(crashLogPath_),
                 "%s/crash.log", filesDirAbsolute);
        haveCrashLog_ = true;
    }

    // Alternate stack so a stack-overflow crash still has somewhere to
    // run the handler.
    stack_t ss{};
    ss.ss_sp    = altStack_;
    ss.ss_size  = sizeof(altStack_);
    ss.ss_flags = 0;
    sigaltstack(&ss, nullptr);

    struct sigaction sa{};
    sa.sa_sigaction = handler;
    sa.sa_flags     = SA_SIGINFO | SA_ONSTACK;
    sigemptyset(&sa.sa_mask);

    const int sigs[] = { SIGSEGV, SIGBUS, SIGABRT, SIGILL, SIGFPE, SIGTRAP };
    for (int s : sigs) sigaction(s, &sa, nullptr);

    __android_log_print(ANDROID_LOG_INFO, "Penrose",
                        "crash handler installed (log=%s)",
                        haveCrashLog_ ? crashLogPath_ : "<logcat only>");
}

} // namespace penrose::crash
