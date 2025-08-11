// main.js (ES module) — WebGPU frontend, expects wgsl files in ./shaders/
import init, {
  get_positions,
  get_radii,
  get_colors,
  get_bonds
} from "./pkg/wasm_molecule.js";

const canvas = document.getElementById('canvas');

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
  return await r.text();
}

function resizeCanvasToDisplaySize(canvas) {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.floor(canvas.clientWidth * dpr);
  const height = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

async function initWebGPU() {
  if (!navigator.gpu) throw new Error('No WebGPU supported in this browser.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No suitable GPU adapter found.');
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });
  return { device, context, format };
}

// math helpers
function perspective(fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect; out[1]=0; out[2]=0; out[3]=0;
  out[4]=0; out[5]=f; out[6]=0; out[7]=0;
  out[8]=0; out[9]=0; out[10]=(far+near)*nf; out[11]=-1;
  out[12]=0; out[13]=0; out[14]=(2*far*near)*nf; out[15]=0;
  return out;
}
function lookAt(eye, center, up) {
  const zx = eye[0]-center[0], zy = eye[1]-center[1], zz = eye[2]-center[2];
  let zlen = Math.hypot(zx,zy,zz);
  const z = [zx/zlen, zy/zlen, zz/zlen];
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const out = new Float32Array(16);
  out[0]=x[0]; out[1]=y[0]; out[2]=z[0]; out[3]=0;
  out[4]=x[1]; out[5]=y[1]; out[6]=z[1]; out[7]=0;
  out[8]=x[2]; out[9]=y[2]; out[10]=z[2]; out[11]=0;
  out[12]=-(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]);
  out[13]=-(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]);
  out[14]=-(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]);
  out[15]=1;
  return out;
}
function cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function normalize(v){ const L = Math.hypot(...v); return [v[0]/L,v[1]/L,v[2]/L]; }
function mat4Mul(a,b){
  const out = new Float32Array(16);
  for(let i=0;i<4;i++) for(let j=0;j<4;j++){
    let s=0; for(let k=0;k<4;k++) s+=a[i*4+k]*b[k*4+j];
    out[i*4+j]=s;
  }
  return out;
}

async function run() {
  await init(); // wasm init

  // --- get data from wasm ---
  const pos = new Float32Array(get_positions()); // 3*N
  const radii = new Float32Array(get_radii());   // N
  const colors = new Float32Array(get_colors()); // 3*N
  const bonds = new Uint16Array(get_bonds());    // pairs

  const N = pos.length / 3;
  console.log("DEBUG: atom count N =", N, "positions:", pos, "radii:", radii, "colors:", colors);

  // --- webgpu init ---
  const { device, context, format } = await initWebGPU();

  // fetch shaders
  const vsSource = await fetchText('./shaders/vertex.wgsl');
  const fsSource = await fetchText('./shaders/fragment.wgsl');

  // create GPU buffers
  const quadVerts = new Float32Array([
    -1, -1,  1, -1, -1,  1,
    -1,  1,  1, -1,  1,  1
  ]); // 6 vertices * vec2

  const quadBuf = device.createBuffer({
    size: quadVerts.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true
  });
  new Float32Array(quadBuf.getMappedRange()).set(quadVerts);
  quadBuf.unmap();

  const centerBuf = device.createBuffer({
    size: pos.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(centerBuf, 0, pos.buffer, pos.byteOffset, pos.byteLength);

  const radiusBuf = device.createBuffer({
    size: radii.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(radiusBuf, 0, radii.buffer, radii.byteOffset, radii.byteLength);

  const colorBuf = device.createBuffer({
    size: colors.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(colorBuf, 0, colors.buffer, colors.byteOffset, colors.byteLength);

  // uniform buffer: viewProj mat4x4<f32> (16 floats = 64 bytes)
  const uniformBufferSize = 16 * 4;
  const uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  // compile shaders (separate modules)
  const vsModule = device.createShaderModule({ code: vsSource });
  const fsModule = device.createShaderModule({ code: fsSource });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: vsModule,
      entryPoint: 'vs_main',
      buffers: [
        { // quad, per-vertex
          arrayStride: 2 * 4,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
        },
        { // center, per-instance
          arrayStride: 3 * 4,
          stepMode: 'instance',
          attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }]
        },
        { // radius, per-instance
          arrayStride: 4,
          stepMode: 'instance',
          attributes: [{ shaderLocation: 2, offset: 0, format: 'float32' }]
        },
        { // color, per-instance
          arrayStride: 3 * 4,
          stepMode: 'instance',
          attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x3' }]
        }
      ]
    },
    fragment: {
      module: fsModule,
      entryPoint: 'fs_main',
      targets: [{ format }]
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
  });

  // depth texture helper
  let depthTexture = null;
  function makeDepth() {
    if (depthTexture) depthTexture.destroy();
    depthTexture = device.createTexture({
      size: [canvas.width, canvas.height, 1],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
  }

  const uniformBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

  // camera / orbit
  const state = { rotX: 0, rotY: 0, dist: 3.0, panX:0, panY:0 };
  let dragging=false, right=false, lastX=0, lastY=0;
  canvas.addEventListener('pointerdown', (e)=>{ canvas.setPointerCapture(e.pointerId); lastX=e.clientX; lastY=e.clientY; dragging=true; right = e.button===2; });
  canvas.addEventListener('pointerup', ()=>{ dragging=false; right=false; });
  canvas.addEventListener('pointermove', (e)=>{ if(!dragging) return; const dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY; if(right){ state.panX += dx*0.002; state.panY -= dy*0.002; } else { state.rotY += dx*0.005; state.rotX += dy*0.005; state.rotX = Math.max(-Math.PI/2+0.01, Math.min(Math.PI/2-0.01, state.rotX)); } });
  canvas.addEventListener('wheel', (e)=>{ e.preventDefault(); state.dist *= Math.exp(e.deltaY*0.001); state.dist = Math.max(0.1, Math.min(100, state.dist)); }, { passive:false });
  canvas.addEventListener('contextmenu', (e)=>e.preventDefault());

  // draw loop
  function frame() {
    resizeCanvasToDisplaySize(canvas);
    makeDepth();

    const aspect = canvas.width / canvas.height;
    const proj = perspective(45*Math.PI/180, aspect, 0.01, 100.0);

    const camDir = [
      Math.cos(state.rotX)*Math.sin(state.rotY),
      Math.sin(state.rotX),
      Math.cos(state.rotX)*Math.cos(state.rotY)
    ];
    const camPos = [camDir[0]*state.dist + state.panX, camDir[1]*state.dist + state.panY, camDir[2]*state.dist];
    const view = lookAt(camPos, [0,0,0], [0,1,0]);
    const viewProj = mat4Mul(proj, view);

    // write viewProj (Float32Array of length 16)
    device.queue.writeBuffer(uniformBuffer, 0, viewProj.buffer, viewProj.byteOffset, viewProj.byteLength);

    const encoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: textureView, loadOp: 'clear', clearValue: { r:0.07,g:0.07,b:0.09,a:1 }, storeOp:'store' }],
      depthStencilAttachment: { view: depthTexture.createView(), depthLoadOp:'clear', depthClearValue:1.0, depthStoreOp:'store' }
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, uniformBindGroup);

    pass.setVertexBuffer(0, quadBuf);
    pass.setVertexBuffer(1, centerBuf);
    pass.setVertexBuffer(2, radiusBuf);
    pass.setVertexBuffer(3, colorBuf);

    pass.draw(6, N, 0, 0);
    pass.end();
    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

run().catch(err => {
  console.error(err);
  alert('Initialization failed: see console. WebGPU may require a flag/experimental build on your browser.');
});
