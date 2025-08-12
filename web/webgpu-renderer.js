export class WebGPURenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.camera = {
            position: [0, 0, 5],
            rotation: [0, 0],
            zoom: 5
        };
        this.mouse = {
            down: false,
            lastX: 0,
            lastY: 0
        };

        this.setupMouseControls();
    }

    async initialize() {
        // Check WebGPU support
        if (!navigator.gpu) {
            throw new Error('WebGPU not supported');
        }

        // Get adapter and device
        const adapter = await navigator.gpu.requestAdapter();
        this.device = await adapter.requestDevice();

        // Configure canvas
        const context = this.canvas.getContext('webgpu');
        const format = navigator.gpu.getPreferredCanvasFormat();

        context.configure({
            device: this.device,
            format: format,
            alphaMode: 'premultiplied',
        });

        this.context = context;
        this.format = format;

        // Load shaders
        await this.loadShaders();

        // Create pipelines
        this.createPipelines();

        // Create buffers
        this.createBuffers();

        // Handle resize
        this.handleResize();
        window.addEventListener('resize', () => this.handleResize());
    }

    async loadShaders() {
        // Fetch shader files
        const [sphereResponse, cylinderResponse] = await Promise.all([
            fetch('shaders/sphere.wgsl'),
            fetch('shaders/cylinder.wgsl')
        ]);

        this.sphereShader = await sphereResponse.text();
        this.cylinderShader = await cylinderResponse.text();
    }

    createPipelines() {
        // Uniform buffer layout
        const uniformBindGroupLayout = this.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: 'uniform' }
                }
            ]
        });

        // Sphere pipeline
        this.spherePipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [uniformBindGroupLayout]
            }),
            vertex: {
                module: this.device.createShaderModule({ code: this.sphereShader }),
                entryPoint: 'vs_main',
                buffers: [
                    {
                        arrayStride: 32,
                        stepMode: 'instance',
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
                            { shaderLocation: 1, offset: 12, format: 'float32' },   // radius
                            { shaderLocation: 2, offset: 16, format: 'float32x4' }  // color
                        ]
                    }
                ]
            },
            fragment: {
                module: this.device.createShaderModule({ code: this.sphereShader }),
                entryPoint: 'fs_main',
                targets: [{ format: this.format }]
            },
            primitive: {
                topology: 'triangle-strip',
                stripIndexFormat: 'uint32'
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus'
            }
        });

        // Cylinder pipeline
        this.cylinderPipeline = this.device.createRenderPipeline({
            layout: this.device.createPipelineLayout({
                bindGroupLayouts: [uniformBindGroupLayout]
            }),
            vertex: {
                module: this.device.createShaderModule({ code: this.cylinderShader }),
                entryPoint: 'vs_main',
                buffers: [
                    {
                        arrayStride: 32,
                        stepMode: 'instance',
                        attributes: [
                            { shaderLocation: 0, offset: 0, format: 'float32x3' },   // start
                            { shaderLocation: 1, offset: 12, format: 'float32x3' },  // end
                            { shaderLocation: 2, offset: 24, format: 'float32' },    // radius
                            { shaderLocation: 3, offset: 28, format: 'float32x4' }   // color
                        ]
                    }
                ]
            },
            fragment: {
                module: this.device.createShaderModule({ code: this.cylinderShader }),
                entryPoint: 'fs_main',
                targets: [{ format: this.format }]
            },
            primitive: {
                topology: 'triangle-strip',
                stripIndexFormat: 'uint32'
            },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus'
            }
        });

        this.uniformBindGroupLayout = uniformBindGroupLayout;
    }

    createBuffers() {
        // Uniform buffer for matrices
        this.uniformBuffer = this.device.createBuffer({
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        // Create bind group
        this.uniformBindGroup = this.device.createBindGroup({
            layout: this.uniformBindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: { buffer: this.uniformBuffer }
                }
            ]
        });
    }

    handleResize() {
        const devicePixelRatio = window.devicePixelRatio || 1;
        this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
        this.canvas.height = this.canvas.clientHeight * devicePixelRatio;

        // Create depth texture
        if (this.depthTexture) {
            this.depthTexture.destroy();
        }

        this.depthTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
    }

    setupMouseControls() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.mouse.down = true;
            this.mouse.lastX = e.clientX;
            this.mouse.lastY = e.clientY;
        });

        this.canvas.addEventListener('mouseup', () => {
            this.mouse.down = false;
        });

        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.mouse.down) return;

            const deltaX = e.clientX - this.mouse.lastX;
            const deltaY = e.clientY - this.mouse.lastY;

            this.camera.rotation[0] += deltaY * 0.01;
            this.camera.rotation[1] += deltaX * 0.01;

            this.mouse.lastX = e.clientX;
            this.mouse.lastY = e.clientY;
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.camera.zoom += e.deltaY * 0.01;
            this.camera.zoom = Math.max(1, Math.min(10, this.camera.zoom));
        });
    }

    updateUniforms() {
        // Calculate matrices
        const aspect = this.canvas.width / this.canvas.height;
        const projection = this.perspectiveMatrix(45 * Math.PI / 180, aspect, 0.1, 100);

        const view = this.viewMatrix(
            [0, 0, this.camera.zoom],
            this.camera.rotation
        );

        const viewProjection = this.multiplyMatrices(projection, view);

        // Update uniform buffer
        const uniformData = new Float32Array(64);
        uniformData.set(viewProjection, 0);
        uniformData.set([0, 0, this.camera.zoom, 0], 16); // camera position

        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
    }

    render(atoms, bonds) {
        this.updateUniforms();

        const commandEncoder = this.device.createCommandEncoder();

        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                clearValue: { r: 0.1, g: 0.2, b: 0.4, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store'
            }
        });

        // Render spheres (atoms)
        if (atoms.length > 0) {
            const atomData = new Float32Array(atoms.length * 8);
            atoms.forEach((atom, i) => {
                const offset = i * 8;
                atomData.set(atom.position, offset);
                atomData[offset + 3] = atom.radius;
                atomData.set([...atom.color, 1.0], offset + 4);
            });

            const atomBuffer = this.device.createBuffer({
                size: atomData.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true
            });
            new Float32Array(atomBuffer.getMappedRange()).set(atomData);
            atomBuffer.unmap();

            renderPass.setPipeline(this.spherePipeline);
            renderPass.setBindGroup(0, this.uniformBindGroup);
            renderPass.setVertexBuffer(0, atomBuffer);
            renderPass.draw(4, atoms.length);
        }

        // Render cylinders (bonds)
        if (bonds.length > 0) {
            const bondData = new Float32Array(bonds.length * 8);
            bonds.forEach((bond, i) => {
                const offset = i * 8;
                bondData.set(bond.start, offset);
                bondData.set(bond.end, offset + 3);
                bondData[offset + 6] = bond.radius;
                bondData[offset + 7] = 1.0; // padding for alignment
            });

            const bondBuffer = this.device.createBuffer({
                size: bondData.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true
            });
            new Float32Array(bondBuffer.getMappedRange()).set(bondData);
            bondBuffer.unmap();

            renderPass.setPipeline(this.cylinderPipeline);
            renderPass.setBindGroup(0, this.uniformBindGroup);
            renderPass.setVertexBuffer(0, bondBuffer);
            renderPass.draw(4, bonds.length);
        }

        renderPass.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }

    // Matrix math utilities
    perspectiveMatrix(fov, aspect, near, far) {
        const f = 1.0 / Math.tan(fov / 2);
        const nf = 1 / (near - far);

        return new Float32Array([
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (far + near) * nf, -1,
            0, 0, 2 * far * near * nf, 0
        ]);
    }

    viewMatrix(position, rotation) {
        const cosX = Math.cos(rotation[0]);
        const sinX = Math.sin(rotation[0]);
        const cosY = Math.cos(rotation[1]);
        const sinY = Math.sin(rotation[1]);

        const rotX = new Float32Array([
            1, 0, 0, 0,
            0, cosX, sinX, 0,
            0, -sinX, cosX, 0,
            0, 0, 0, 1
        ]);

        const rotY = new Float32Array([
            cosY, 0, -sinY, 0,
            0, 1, 0, 0,
            sinY, 0, cosY, 0,
            0, 0, 0, 1
        ]);

        const translation = new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            -position[0], -position[1], -position[2], 1
        ]);

        return this.multiplyMatrices(
            this.multiplyMatrices(rotX, rotY),
            translation
        );
    }

    multiplyMatrices(a, b) {
        const result = new Float32Array(16);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) {
                    sum += a[i * 4 + k] * b[k * 4 + j];
                }
                result[i * 4 + j] = sum;
            }
        }
        return result;
    }
}
