#version 460

layout(location = 0) in vec2 inPos;

layout(push_constant) uniform PC {
    vec4 view0;
    vec4 view1;
} pc;

void main() {
    float x = pc.view0.x * inPos.x + pc.view0.y * inPos.y + pc.view0.z;
    float y = pc.view1.x * inPos.x + pc.view1.y * inPos.y + pc.view1.z;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
