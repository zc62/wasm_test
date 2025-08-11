@fragment
fn fs_main(
  @location(0) v_quad : vec2<f32>,
  @location(1) v_color : vec3<f32>,
  @location(2) v_radius : f32
) -> @location(0) vec4<f32> {
  let r2 = dot(v_quad, v_quad);
  if (r2 > 1.0) {
    discard;
  }
  let nz = sqrt(max(0.0, 1.0 - r2));
  let normal = normalize(vec3<f32>(v_quad.x, v_quad.y, nz));
  let lightDir = normalize(vec3<f32>(0.5, 0.8, 0.6));
  let diff = max(dot(normal, lightDir), 0.0);
  let col = v_color * (0.18 + 0.82 * diff);
  return vec4<f32>(col, 1.0);
}
