#include "penrose.h"

#include <cmath>
#include <utility>

namespace penrose {

namespace {

constexpr double kPi  = 3.14159265358979323846;
constexpr double kPhi = 1.6180339887498949;
constexpr double kPsi = 1.0 / kPhi;            // ~0.6180339887
constexpr double kPsi2 = kPsi * kPsi;          // ~0.3819660113

inline void comb(float ax, float ay, double a,
                 float bx, float by, double b,
                 float& ox, float& oy) {
    ox = static_cast<float>(a * ax + b * bx);
    oy = static_cast<float>(a * ay + b * by);
}

} // namespace

std::vector<Tri> seedP3Sun() {
    // 10 S triangles, every other one flipped to maintain orientation so that
    // adjacent pairs share their base (forming a thick rhomb). Apex at origin.
    std::vector<Tri> out;
    out.reserve(10);
    for (int i = 0; i < 10; ++i) {
        const double a1 = (2.0 * kPi * i) / 10.0;
        const double a2 = (2.0 * kPi * (i + 1)) / 10.0;
        float ax = static_cast<float>(std::cos(a1));
        float ay = static_cast<float>(std::sin(a1));
        float cx = static_cast<float>(std::cos(a2));
        float cy = static_cast<float>(std::sin(a2));
        if ((i & 1) == 0) { std::swap(ax, cx); std::swap(ay, cy); }
        out.push_back(Tri{ ax, ay, 0.0f, 0.0f, cx, cy, /*type=*/1 });
    }
    return out;
}

std::vector<Tri> subdivideP3(const std::vector<Tri>& in) {
    // Growth factor is phi^2 ≈ 2.618 per step. Pre-reserve generously.
    std::vector<Tri> out;
    out.reserve(in.size() * 3);

    for (const Tri& t : in) {
        const float Ax = t.ax, Ay = t.ay;
        const float Bx = t.bx, By = t.by;
        const float Cx = t.cx, Cy = t.cy;

        if (t.type == 0) { // L (obtuse) → 2 L + 1 S
            float Dx, Dy, Ex, Ey;
            comb(Ax, Ay, kPsi2, Cx, Cy, kPsi, Dx, Dy);
            comb(Ax, Ay, kPsi2, Bx, By, kPsi, Ex, Ey);
            out.push_back(Tri{ Dx, Dy, Ex, Ey, Ax, Ay, 0 });
            out.push_back(Tri{ Ex, Ey, Dx, Dy, Bx, By, 1 });
            out.push_back(Tri{ Cx, Cy, Dx, Dy, Bx, By, 0 });
        } else {           // S (acute) → 1 L + 1 S
            float Dx, Dy;
            comb(Ax, Ay, kPsi, Bx, By, kPsi2, Dx, Dy);
            out.push_back(Tri{ Dx, Dy, Cx, Cy, Ax, Ay, 1 });
            out.push_back(Tri{ Cx, Cy, Dx, Dy, Bx, By, 0 });
        }
    }
    return out;
}

} // namespace penrose
