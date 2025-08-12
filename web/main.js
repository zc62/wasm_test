import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPURenderer from 'three/addons/renderers/webgpu/WebGPURenderer.js';
import init, { MolecularSystem, Camera } from './pkg/molecule.js';

class LargeScaleMolecularVisualization {
    constructor() {
        this.atomInstancedMeshes = new Map();
        this.camera = null;
        this.wasmCamera = null;
        this.atomCount = 100;
        this.maxAtomCount = 100_000_000; // 100M
        this.isGenerating = false;
        this.webgpuSupported = false;

        // WebGPU compute resources
        this.device = null;
        this.computePipeline = null;
        this.atomBuffer = null;
        this.cameraBuffer = null;
        this.resultBuffer = null;
        this.readBuffer = null;
        this.bindGroup = null;

        this.stats = {
            totalAtoms: 0,
            visibleAtoms: 0,
            memoryUsage: 0,
            fps: 0,
            renderTime: 0,
            computeTime: 0,
            lastCameraUpdate: 0
        };

        // Element colors
        this.elementColors = [
            new THREE.Color(1.0, 1.0, 1.0), // H - white
            new THREE.Color(0.2, 0.8, 0.3), // F - green
            new THREE.Color(1.0, 0.2, 0.2), // O - red
            new THREE.Color(0.2, 0.2, 1.0), // N - blue
        ];

        // LOD geometries
        this.lodGeometries = {
            0: this.createPointGeometry(),
            1: new THREE.SphereGeometry(0.1, 6, 6),   // Ultra low-poly
            2: new THREE.SphereGeometry(0.1, 12, 12), // Low-poly
            3: new THREE.SphereGeometry(0.1, 20, 20), // High-poly
        };

        this.frameCounter = 0;
        this.lastTime = performance.now();
        this.cameraChanged = false;
    }

    createPointGeometry() {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array([0, 0, 0]);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        return geometry;
    }

    async init() {
        try {
            // Check WebGPU support
            if (!navigator.gpu) {
                throw new Error('WebGPU not supported');
            }

            // Initialize WASM
            await init();
            this.molecularSystem = new MolecularSystem();
            this.wasmCamera = new Camera();

            // Setup WebGPU
            await this.setupWebGPU();
            await this.setupWebGPUScene();
            this.setupLights();
            this.setupControls();
            this.setupInstancedMeshes();
            await this.setupComputeShaders();
            this.handleResize();
            this.setupUIControls();

            // Generate initial atoms
            await this.generateAtoms(this.atomCount);

            // Start animation
            this.animate();

            console.log('WebGPU molecular visualization initialized successfully');
            this.webgpuSupported = true;
        } catch (error) {
            console.error('WebGPU initialization failed, falling back to WebGL:', error);
            await this.fallbackToWebGL();
        }
    }

    async setupWebGPU() {
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });

        if (!adapter) {
            throw new Error('No WebGPU adapter found');
        }

        this.device = await adapter.requestDevice({
            requiredFeatures: [],
            requiredLimits: {
                maxStorageBufferBindingSize: 1024 * 1024 * 1024, // 1GB
                maxComputeWorkgroupStorageSize: 32768,
                maxComputeInvocationsPerWorkgroup: 1024,
            }
        });

        this.device.lost.then((info) => {
            console.error('WebGPU device lost:', info.message);
        });

        console.log('WebGPU device initialized');
    }

    async setupWebGPUScene() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a1929);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            45,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(10, 10, 20);

        // WebGPU Renderer
        const canvas = document.getElementById('canvas');
        this.renderer = new WebGPURenderer({
            canvas,
            antialias: true,
            powerPreference: 'high-performance'
        });

        await this.renderer.init();
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Add coordinate system
        const axesHelper = new THREE.AxesHelper(5);
        this.scene.add(axesHelper);
    }

    async fallbackToWebGL() {
        console.log('Falling back to WebGL renderer...');

        const canvas = document.getElementById('canvas');
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.webgpuSupported = false;

        this.showStatus('Running in WebGL fallback mode - compute shaders disabled');
    }

    async setupComputeShaders() {
        if (!this.webgpuSupported || !this.device) return;

        try {
            // Create compute shader for LOD processing
            const computeShaderCode = /* wgsl */`
                struct Camera {
                    position: vec3<f32>,
                    target: vec3<f32>,
                    fov: f32,
                    aspect: f32,
                    near: f32,
                    far: f32,
                    time: f32,
                    padding: f32,
                }

                struct Atom {
                    position: vec3<f32>,
                    element: f32,
                }

                struct AtomResult {
                    position: vec3<f32>,
                    element: f32,
                    radius: f32,
                    lod_level: f32,
                    distance: f32,
                    visible: f32,
                }

                @group(0) @binding(0) var<uniform> camera: Camera;
                @group(0) @binding(1) var<storage, read> atoms: array<Atom>;
                @group(0) @binding(2) var<storage, read_write> results: array<AtomResult>;

                fn calculateAggressionFactor(atomCount: u32) -> f32 {
                    if (atomCount <= 1000u) { return 1.0; }
                    else if (atomCount <= 10000u) { return 2.0; }
                    else if (atomCount <= 100000u) { return 4.0; }
                    else if (atomCount <= 1000000u) { return 8.0; }
                    else if (atomCount <= 10000000u) { return 16.0; }
                    else { return 32.0; }
                }

                fn isInFrustum(pos: vec3<f32>, cam: Camera) -> bool {
                    let toCamera = pos - cam.position;
                    let distance = length(toCamera);

                    // Basic distance culling
                    if (distance > cam.far * 0.8) {
                        return false;
                    }

                    // Frustum culling
                    let forward = normalize(cam.target - cam.position);
                    if (distance > 0.0) {
                        let toAtom = normalize(toCamera);
                        let dot = dot(-toAtom, forward);

                        // Use FOV to determine visibility cone
                        let fovThreshold = cos(cam.fov * 0.6); // Slightly wider than actual FOV
                        if (dot < fovThreshold) {
                            return false;
                        }
                    }

                    return true;
                }

                fn calculateLOD(distance: f32, aggression: f32) -> f32 {
                    let pointThreshold = 50.0 * aggression;
                    let lowPolyThreshold = 20.0 * aggression;
                    let mediumPolyThreshold = 10.0 * aggression;

                    if (distance > pointThreshold) { return 0.0; }
                    else if (distance > lowPolyThreshold) { return 1.0; }
                    else if (distance > mediumPolyThreshold) { return 2.0; }
                    else { return 3.0; }
                }

                fn getElementRadius(element: f32) -> f32 {
                    let elem = u32(element);
                    switch elem {
                        case 0u: { return 0.25; } // H
                        case 1u: { return 0.35; } // F
                        case 2u: { return 0.3; }  // O
                        default: { return 0.28; } // N
                    }
                }

                @compute @workgroup_size(64)
                fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
                    let index = globalId.x;
                    let atomCount = arrayLength(&atoms);

                    if (index >= atomCount) {
                        return;
                    }

                    let atom = atoms[index];
                    let aggression = calculateAggressionFactor(atomCount);

                    // Calculate distance to camera
                    let toCamera = atom.position - camera.position;
                    let distance = length(toCamera);

                    // Initialize result
                    var result: AtomResult;
                    result.position = atom.position;
                    result.element = atom.element;
                    result.distance = distance;
                    result.visible = 0.0;

                    // Check if atom is visible
                    if (isInFrustum(atom.position, camera)) {
                        result.visible = 1.0;

                        // Calculate LOD
                        result.lod_level = calculateLOD(distance, aggression);

                        // Calculate animated radius
                        let baseRadius = getElementRadius(atom.element);
                        let animatedRadius = baseRadius + 0.02 * sin(camera.time + atom.position.x + atom.position.y + atom.position.z);
                        result.radius = animatedRadius;
                    }

                    results[index] = result;
                }
            `;

            // Create compute shader module
            const shaderModule = this.device.createShaderModule({
                code: computeShaderCode
            });

            // Create compute pipeline
            this.computePipeline = this.device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: shaderModule,
                    entryPoint: 'main'
                }
            });

            console.log('WebGPU compute shaders initialized');
        } catch (error) {
            console.error('Failed to setup compute shaders:', error);
            this.webgpuSupported = false;
        }
    }

    async createComputeBuffers(atomCount) {
        if (!this.device || atomCount === 0) return;

        // Create camera uniform buffer
        this.cameraBuffer = this.device.createBuffer({
            size: 8 * 4, // 8 floats
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        // Create atom storage buffer
        const atomBufferSize = atomCount * 4 * 4; // 4 floats per atom
        this.atomBuffer = this.device.createBuffer({
            size: atomBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        // Create result storage buffer
        const resultBufferSize = atomCount * 8 * 4; // 8 floats per result
        this.resultBuffer = this.device.createBuffer({
            size: resultBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        });

        // Create read buffer for getting results back to CPU
        this.readBuffer = this.device.createBuffer({
            size: resultBufferSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });

        // Create bind group
        this.bindGroup = this.device.createBindGroup({
            layout: this.computePipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.cameraBuffer
                    }
                },
                {
                    binding: 1,
                    resource: {
                        buffer: this.atomBuffer
                    }
                },
                {
                    binding: 2,
                    resource: {
                        buffer: this.resultBuffer
                    }
                }
            ]
        });

        console.log(`Created WebGPU buffers for ${atomCount} atoms`);
    }

    setupLights() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        // Main directional light
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(50, 50, 50);
        this.scene.add(dirLight);

        // Fill light
        const fillLight = new THREE.DirectionalLight(0x4488ff, 0.3);
        fillLight.position.set(-25, 25, -25);
        this.scene.add(fillLight);
    }

    setupControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 500;
        this.controls.autoRotate = false;
        this.controls.autoRotateSpeed = 0.5;

        // Mark camera as changed on every control change
        this.controls.addEventListener('change', () => {
            this.updateWasmCamera();
            this.cameraChanged = true; // Flag for compute shader update
            this.stats.lastCameraUpdate = performance.now();
        });
    }

    setupInstancedMeshes() {
        const maxInstances = 100000; // Max instances per LOD level

        // Create instanced meshes for different LOD levels
        for (let lod = 0; lod < 4; lod++) {
            let material;
            let mesh;

            if (lod === 0) {
                // Points for distant objects
                material = new THREE.PointsMaterial({
                    size: 0.1,
                    vertexColors: true,
                    sizeAttenuation: false
                });
                mesh = new THREE.Points(this.lodGeometries[0], material);
            } else {
                // Instanced meshes for closer objects
                material = new THREE.MeshBasicMaterial({ vertexColors: true });

                mesh = new THREE.InstancedMesh(
                    this.lodGeometries[lod],
                    material,
                    maxInstances
                );
                mesh.count = 0;
            }

            this.atomInstancedMeshes.set(lod, mesh);
            this.scene.add(mesh);
        }
    }

    updateWasmCamera() {
        if (this.wasmCamera) {
            this.wasmCamera.x = this.camera.position.x;
            this.wasmCamera.y = this.camera.position.y;
            this.wasmCamera.z = this.camera.position.z;

            const target = this.controls.target;
            this.wasmCamera.target_x = target.x;
            this.wasmCamera.target_y = target.y;
            this.wasmCamera.target_z = target.z;
        }
    }

    async generateAtoms(count) {
        if (this.isGenerating) return;

        this.isGenerating = true;
        this.showStatus(`Generating ${count.toLocaleString()} atoms...`);

        try {
            await new Promise(resolve => setTimeout(resolve, 10));

            // Use the new file reading simulation method
            this.molecularSystem.load_atoms_from_file(count);
            this.atomCount = count;
            this.stats.totalAtoms = count;

            // Create WebGPU buffers for the new atom count
            if (this.webgpuSupported && count > 1000) {
                await this.createComputeBuffers(count);
                await this.uploadAtomDataToGPU();
            }

            this.showStatus(`Generated ${count.toLocaleString()} atoms successfully`);
            console.log(`Generated ${count.toLocaleString()} atoms with file reading simulation`);
        } catch (error) {
            console.error('Failed to generate atoms:', error);
            this.showError(`Failed to generate ${count.toLocaleString()} atoms`);
        } finally {
            this.isGenerating = false;
        }
    }

    async uploadAtomDataToGPU() {
        if (!this.device || !this.atomBuffer) return;

        // Get all atom positions from WASM
        const atomData = this.molecularSystem.get_all_atom_positions();

        if (atomData.length === 0) return;

        // Upload atom data to GPU
        this.device.queue.writeBuffer(
            this.atomBuffer,
            0,
            new Float32Array(atomData)
        );

        console.log(`Uploaded ${atomData.length / 4} atoms to GPU`);
    }

    async updateComputeShaderCamera() {
        if (!this.device || !this.cameraBuffer) return;

        // Create camera data array
        const cameraData = new Float32Array([
            this.camera.position.x, this.camera.position.y, this.camera.position.z, // position
            this.controls.target.x, this.controls.target.y, this.controls.target.z,  // target
            this.camera.fov * Math.PI / 180, // fov in radians
            this.camera.aspect,               // aspect
            this.camera.near,                 // near
            this.camera.far,                  // far
            performance.now() * 0.001,       // time
            0.0                              // padding
        ]);

        // Upload camera data to GPU
        this.device.queue.writeBuffer(this.cameraBuffer, 0, cameraData);
    }

    async runComputeShader() {
        if (!this.device || !this.computePipeline || !this.bindGroup) return null;

        const computeStartTime = performance.now();

        // Update camera data
        await this.updateComputeShaderCamera();

        // Create command encoder
        const encoder = this.device.createCommandEncoder();

        // Create compute pass
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(this.computePipeline);
        computePass.setBindGroup(0, this.bindGroup);

        // Dispatch compute shader
        const atomCount = this.stats.totalAtoms;
        const workgroupSize = 64;
        const numWorkgroups = Math.ceil(atomCount / workgroupSize);
        computePass.dispatchWorkgroups(numWorkgroups);
        computePass.end();

        // Copy results to read buffer
        encoder.copyBufferToBuffer(
            this.resultBuffer, 0,
            this.readBuffer, 0,
            this.readBuffer.size
        );

        // Submit commands
        this.device.queue.submit([encoder.finish()]);

        // Read results
        await this.readBuffer.mapAsync(GPUMapMode.READ);
        const resultData = new Float32Array(this.readBuffer.getMappedRange());
        const results = Array.from(resultData);
        this.readBuffer.unmap();

        this.stats.computeTime = performance.now() - computeStartTime;

        return results;
    }

    async updateVisualization() {
        if (!this.molecularSystem || this.isGenerating) return;

        const startTime = performance.now();

        try {
            this.updateWasmCamera();

            if (this.webgpuSupported && this.stats.totalAtoms > 1000 && this.cameraChanged) {
                // Use WebGPU compute shader for large datasets
                await this.updateVisualizationWebGPU();
                this.cameraChanged = false; // Reset flag
            } else if (this.stats.totalAtoms <= 1000 || !this.webgpuSupported) {
                // Use CPU path for smaller datasets or WebGL fallback
                this.updateVisualizationCPU();
            }

            this.stats.renderTime = performance.now() - startTime;
        } catch (error) {
            console.error('Error updating visualization:', error);
        }
    }

    async updateVisualizationWebGPU() {
        console.log('Updating visualization with WebGPU compute shaders...');

        // Run compute shader to get visible atoms with LOD
        const computeResults = await this.runComputeShader();

        if (!computeResults) return;

        // Parse compute results
        const atomsByLOD = new Map();
        for (let i = 0; i < 4; i++) {
            atomsByLOD.set(i, []);
        }

        let visibleCount = 0;
        const floatsPerResult = 8; // position(3) + element(1) + radius(1) + lod(1) + distance(1) + visible(1)

        for (let i = 0; i < computeResults.length; i += floatsPerResult) {
            const visible = computeResults[i + 7]; // visible flag

            if (visible > 0.5) { // visible
                const atom = {
                    x: computeResults[i],
                    y: computeResults[i + 1],
                    z: computeResults[i + 2],
                    element: Math.floor(computeResults[i + 3]),
                    radius: computeResults[i + 4],
                    lod_level: Math.floor(computeResults[i + 5])
                };

                atomsByLOD.get(atom.lod_level).push(atom);
                visibleCount++;
            }
        }

        // Update instanced meshes
        atomsByLOD.forEach((atoms, lodLevel) => {
            const mesh = this.atomInstancedMeshes.get(lodLevel);

            if (lodLevel === 0) {
                this.updatePointsLOD(atoms);
            } else {
                this.updateInstancedMeshLOD(mesh, atoms, lodLevel);
            }
        });

        this.stats.visibleAtoms = visibleCount;
        console.log(`WebGPU processed ${visibleCount} visible atoms from ${this.stats.totalAtoms} total`);
    }

    updateVisualizationCPU() {
        // CPU fallback for smaller datasets or when WebGPU unavailable
        const visibleAtoms = this.molecularSystem.get_visible_atoms_for_camera(
            this.wasmCamera,
            this.camera.fov * Math.PI / 180,
            this.camera.aspect,
            this.camera.near,
            this.camera.far
        );

        this.stats.visibleAtoms = visibleAtoms.length;

        // Group atoms by LOD level
        const atomsByLOD = new Map();
        for (let i = 0; i < 4; i++) {
            atomsByLOD.set(i, []);
        }

        for (let i = 0; i < visibleAtoms.length; i++) {
            const atom = visibleAtoms[i];
            atomsByLOD.get(atom.lod_level).push(atom);
        }

        // Update instanced meshes
        atomsByLOD.forEach((atoms, lodLevel) => {
            const mesh = this.atomInstancedMeshes.get(lodLevel);

            if (lodLevel === 0) {
                this.updatePointsLOD(atoms);
            } else {
                this.updateInstancedMeshLOD(mesh, atoms, lodLevel);
            }
        });
    }

    updatePointsLOD(atoms) {
        const points = this.atomInstancedMeshes.get(0);
        const positions = [];
        const colors = [];

        atoms.forEach(atom => {
            positions.push(atom.x, atom.y, atom.z);
            const color = this.elementColors[atom.element];
            colors.push(color.r, color.g, color.b);
        });

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        points.geometry.dispose();
        points.geometry = geometry;
    }

    updateInstancedMeshLOD(mesh, atoms, lodLevel) {
        if (!mesh) return;

        mesh.count = Math.min(atoms.length, mesh.instanceMatrix.count);

        const matrix = new THREE.Matrix4();

        for (let i = 0; i < mesh.count; i++) {
            const atom = atoms[i];

            matrix.makeScale(atom.radius, atom.radius, atom.radius);
            matrix.setPosition(atom.x, atom.y, atom.z);
            mesh.setMatrixAt(i, matrix);

            mesh.setColorAt(i, this.elementColors[atom.element]);
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
        }
    }

    setupUIControls() {
        const atomCountSlider = document.getElementById('atom-count-slider');
        const generateButton = document.getElementById('generate-button');

        atomCountSlider.value = Math.log10(this.atomCount);
        this.updateAtomCountDisplay();

        atomCountSlider.addEventListener('input', (e) => {
            const logValue = parseFloat(e.target.value);
            this.atomCount = Math.round(Math.pow(10, logValue));
            this.updateAtomCountDisplay();
        });

        generateButton.addEventListener('click', () => {
            if (!this.isGenerating) {
                this.generateAtoms(this.atomCount);
            }
        });

        const gridSizeSlider = document.getElementById('grid-size-slider');
        gridSizeSlider.addEventListener('input', (e) => {
            const size = parseFloat(e.target.value);
            this.molecularSystem.set_grid_size(size);
            document.getElementById('grid-size-value').textContent = size.toFixed(1);
        });

        const speedSlider = document.getElementById('speed-slider');
        speedSlider.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            this.molecularSystem.set_animation_speed(speed);
            document.getElementById('speed-value').textContent = speed.toFixed(1) + 'x';
        });

        const autoRotateToggle = document.getElementById('auto-rotate');
        autoRotateToggle.addEventListener('change', (e) => {
            this.controls.autoRotate = e.target.checked;
        });

        window.addEventListener('keydown', (e) => {
            switch(e.key) {
                case ' ':
                    e.preventDefault();
                    this.controls.autoRotate = !this.controls.autoRotate;
                    autoRotateToggle.checked = this.controls.autoRotate;
                    break;
                case 'r':
                    this.resetCamera();
                    break;
            }
        });

        setInterval(() => this.updateStatsDisplay(), 1000);
    }

    updateAtomCountDisplay() {
        const atomCountValue = document.getElementById('atom-count-value');
        if (this.atomCount >= 1000000) {
            atomCountValue.textContent = (this.atomCount / 1000000).toFixed(1) + 'M';
        } else if (this.atomCount >= 1000) {
            atomCountValue.textContent = (this.atomCount / 1000).toFixed(1) + 'K';
        } else {
            atomCountValue.textContent = this.atomCount.toString();
        }
    }

    updateStatsDisplay() {
        const statsDiv = document.getElementById('stats');
        if (statsDiv) {
            const memoryInfo = performance.memory ?
                `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB` : 'N/A';

            const renderMode = this.webgpuSupported ? 'WebGPU' : 'WebGL';
            const lastUpdate = this.stats.lastCameraUpdate > 0 ?
                `${((performance.now() - this.stats.lastCameraUpdate) / 1000).toFixed(1)}s ago` : 'Never';

            const lodInfo = this.stats.lodBreakdown ?
                `<br>LOD - Points:${this.stats.lodBreakdown.points}, Low:${this.stats.lodBreakdown.low}, Med:${this.stats.lodBreakdown.medium}, High:${this.stats.lodBreakdown.high}` : '';

            statsDiv.innerHTML = `
                <strong>Performance Stats (${renderMode}):</strong><br>
                Total Atoms: ${this.stats.totalAtoms.toLocaleString()}<br>
                Visible Atoms: ${this.stats.visibleAtoms.toLocaleString()}${lodInfo}<br>
                Last Camera Update: ${lastUpdate}<br>
                FPS: ${this.stats.fps}<br>
                CPU Time: ${this.stats.renderTime.toFixed(1)}ms<br>
                GPU Compute: ${this.stats.computeTime.toFixed(1)}ms<br>
                Memory Usage: ${memoryInfo}
            `;
        }
    }

    showStatus(message) {
        const statusDiv = document.getElementById('status');
        if (statusDiv) {
            statusDiv.textContent = message;
            statusDiv.className = 'status';
        }
        console.log(message);
    }

    showError(message) {
        const statusDiv = document.getElementById('status');
        if (statusDiv) {
            statusDiv.textContent = message;
            statusDiv.className = 'status error';
        }
        console.error(message);
    }

    resetCamera() {
        this.camera.position.set(10, 10, 20);
        this.controls.reset();
        this.cameraChanged = true; // Force compute shader update
    }

    handleResize() {
        const resize = () => {
            const width = window.innerWidth;
            const height = window.innerHeight;

            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();

            this.renderer.setSize(width, height);
            this.cameraChanged = true; // Camera parameters changed
        };

        resize();
        window.addEventListener('resize', resize);
    }

    animate() {
        const animationLoop = () => {
            requestAnimationFrame(animationLoop);

            const currentTime = performance.now();
            const deltaTime = (currentTime - this.lastTime) / 1000;
            this.lastTime = currentTime;

            this.frameCounter++;
            if (this.frameCounter % 60 === 0) {
                this.stats.fps = Math.round(1 / deltaTime);
            }

            if (this.molecularSystem) {
                this.molecularSystem.update(deltaTime);
            }

            this.updateVisualization();
            this.controls.update();

            this.renderer.render(this.scene, this.camera);
        };

        animationLoop();
    }
}

// Initialize application
const app = new LargeScaleMolecularVisualization();
app.init().catch(console.error);
