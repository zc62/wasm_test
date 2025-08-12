struct Uniforms {
    viewProjection: mat4x4<f32>,
    cameraPosition: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) worldPos: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec4<f32>,
    @location(3) center: vec3<f32>,
    @location(4) radius: f32,
}

@vertex
fn vs_main(
    @builtin(vertex_index) vertexIndex: u32,
    @location(0) center: vec3<f32>,
    @location(1) radius: f32,
    @location(2) color: vec4<f32>
) -> VertexOutput {
    var output: VertexOutput;

    // Generate billboard quad
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0)
    );

    let quadPos = pos[vertexIndex];

    // Billboard calculation
    let worldPos = center + radius * vec3<f32>(quadPos, 0.0);

    output.position = uniforms.viewProjection * vec4<f32>(worldPos, 1.0);
    output.worldPos = worldPos;
    output.normal = normalize(worldPos - center);
    output.color = color;
    output.center = center;
    output.radius = radius;

    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Ray-sphere intersection for proper sphere rendering
    let rayOrigin = uniforms.cameraPosition.xyz;
    let rayDir = normalize(input.worldPos - rayOrigin);

    let oc = rayOrigin - input.center;
    let a = dot(rayDir, rayDir);
    let b = 2.0 * dot(oc, rayDir);
    let c = dot(oc, oc) - input.radius * input.radius;
    let discriminant = b * b - 4.0 * a * c;

    if (discriminant < 0.0) {
        discard;
    }

    let t = (-b - sqrt(discriminant)) / (2.0 * a);
    let hitPoint = rayOrigin + t * rayDir;
    let normal = normalize(hitPoint - input.center);

    // Phong lighting
    let lightDir = normalize(vec3<f32>(1.0, 1.0, 1.0));
    let viewDir = normalize(rayOrigin - hitPoint);
    let halfDir = normalize(lightDir + viewDir);

    let ambient = 0.2;
    let diffuse = max(dot(normal, lightDir), 0.0) * 0.7;
    let specular = pow(max(dot(normal, halfDir), 0.0), 32.0) * 0.5;

    let lighting = ambient + diffuse + specular;

    return vec4<f32>(input.color.rgb * lighting, input.color.a);
}
