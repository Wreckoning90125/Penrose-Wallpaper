#version 460

// Per-vertex.
layout(location = 0) in vec2 inPos;
layout(location = 1) in uint inColorIdx;

// Push constants — view transform packed into two rows of an affine 2D matrix.
//   view0 = (m00, m01, tx)
//   view1 = (m10, m11, ty)
layout(push_constant) uniform PC {
    vec4 view0;
    vec4 view1;
} pc;

layout(location = 0) flat out uint vColorIdx;

void main() {
    float x = pc.view0.x * inPos.x + pc.view0.y * inPos.y + pc.view0.z;
    float y = pc.view1.x * inPos.x + pc.view1.y * inPos.y + pc.view1.z;
    gl_Position = vec4(x, y, 0.0, 1.0);
    vColorIdx = inColorIdx;
}
