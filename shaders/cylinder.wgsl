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
    @location(3) cylinderStart: vec3<f32>,
    @location(4) cylinderEnd: vec3<f32>,
    @location(5) cylinderRadius: f32,
}

@vertex
fn vs_main(
    @builtin(vertex_index) vertexIndex: u32,
    @location(0) start: vec3<f32>,
    @location(1) end: vec3<f32>,
    @location(2) radius: f32,
    @location(3) color: vec4<f32>
) -> VertexOutput {
    var output: VertexOutput;

    // Generate billboard quad that encompasses the cylinder
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0)
    );

    let quadPos = pos[vertexIndex];

    // Calculate cylinder bounding box
    let center = (start + end) * 0.5;
    let length = length(end - start);
    let extent = max(length * 0.5 + radius, radius * 2.0);

    let worldPos = center + extent * vec3<f32>(quadPos, 0.0);

    output.position = uniforms.viewProjection * vec4<f32>(worldPos, 1.0);
    output.worldPos = worldPos;
    output.normal = vec3<f32>(0.0, 0.0, 1.0); // Will be calculated in fragment
    output.color = color;
    output.cylinderStart = start;
    output.cylinderEnd = end;
    output.cylinderRadius = radius;

    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Ray-cylinder intersection
    let rayOrigin = uniforms.cameraPosition.xyz;
    let rayDir = normalize(input.worldPos - rayOrigin);

    let cylinderAxis = normalize(input.cylinderEnd - input.cylinderStart);
    let cylinderLength = length(input.cylinderEnd - input.cylinderStart);

    // Project ray onto cylinder axis
    let d = input.cylinderStart - rayOrigin;
    let v = rayDir - dot(rayDir, cylinderAxis) * cylinderAxis;
    let p = d - dot(d, cylinderAxis) * cylinderAxis;

    let a = dot(v, v);
    if (a < 0.001) {
        discard;
    }

    let b = 2.0 * dot(v, p);
    let c = dot(p, p) - input.cylinderRadius * input.cylinderRadius;

    let discriminant = b * b - 4.0 * a * c;
    if (discriminant < 0.0) {
        discard;
    }

    let t = (-b - sqrt(discriminant)) / (2.0 * a);
    let hitPoint = rayOrigin + t * rayDir;

    // Check if hit point is within cylinder bounds
    let axisPoint = dot(hitPoint - input.cylinderStart, cylinderAxis);
    if (axisPoint < 0.0 || axisPoint > cylinderLength) {
        discard;
    }

    // Calculate normal
    let closestPoint = input.cylinderStart + axisPoint * cylinderAxis;
    let normal = normalize(hitPoint - closestPoint);

    // Phong lighting
    let lightDir = normalize(vec3<f32>(1.0, 1.0, 1.0));
    let viewDir = normalize(rayOrigin - hitPoint);
    let halfDir = normalize(lightDir + viewDir);

    let ambient = 0.2;
    let diffuse = max(dot(normal, lightDir), 0.0) * 0.7;
    let specular = pow(max(dot(normal, halfDir), 0.0), 32.0) * 0.3;

    let lighting = ambient + diffuse + specular;

    return vec4<f32>(vec3<f32>(0.7, 0.7, 0.7) * lighting, 1.0);
}
