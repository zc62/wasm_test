struct Uniforms {
  viewProj : mat4x4<f32>,
}
@group(0) @binding(0)
var<uniform> uniforms : Uniforms;
struct VSOut {
  @builtin(position) Position : vec4<f32>,
  @location(0) v_quad : vec2<f32>,
  @location(1) v_color : vec3<f32>,
  @location(2) v_radius : f32
}
@vertex
fn vs_main(
  @location(0) a_quad : vec2<f32>,
  @location(1) a_center : vec3<f32>,
  @location(2) a_radius : f32,
  @location(3) a_color : vec3<f32>
) -> VSOut {
  var out : VSOut;

  // Use actual atom positions but scale them down and center them
  let atomPosNDC = a_center.xy * 0.5;  // Scale down the atom positions
  out.Position = vec4<f32>(a_quad * 0.15 + atomPosNDC, 0.0, 1.0);

  // Reference uniform so it doesn't get optimized out
  let dummy = uniforms.viewProj[0][0] * 0.0;

  out.v_quad = a_quad;
  out.v_color = a_color;
  out.v_radius = a_radius + dummy;
  return out;
}
