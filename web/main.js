import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import init, { MolecularSystem } from './pkg/molecule.js';

class MolecularVisualization {
    constructor() {
        this.atoms = [];
        this.bonds = [];
        this.atomMeshes = [];
        this.bondMeshes = [];
        this.qualitySettings = {
            low: { sphereSegments: 8, cylinderSegments: 6 },
            medium: { sphereSegments: 16, cylinderSegments: 8 },
            high: { sphereSegments: 32, cylinderSegments: 16 },
            ultra: { sphereSegments: 64, cylinderSegments: 32 }
        };
        this.currentQuality = 'medium';
    }

    async init() {
        // Initialize WASM
        await init();
        this.molecularSystem = new MolecularSystem();

        // Setup Three.js
        this.setupScene();
        this.setupLights();
        this.setupControls();
        this.setupPostProcessing();
        this.handleResize();

        // Setup UI controls
        this.setupUIControls();

        // Start animation
        this.animate();
    }

    setupScene() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a1929);
        this.scene.fog = new THREE.Fog(0x0a1929, 10, 50);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            45,
            window.innerWidth / window.innerHeight,
            0.1,
            100
        );
        this.camera.position.set(0, 2, 5);

        // Renderer
        const canvas = document.getElementById('canvas');
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.2;

        // Add grid for reference
        const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
        this.scene.add(gridHelper);
    }

    setupLights() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        this.scene.add(ambientLight);

        // Main directional light
        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(5, 10, 5);
        dirLight.castShadow = true;
        dirLight.shadow.camera.near = 0.1;
        dirLight.shadow.camera.far = 50;
        dirLight.shadow.camera.left = -10;
        dirLight.shadow.camera.right = 10;
        dirLight.shadow.camera.top = 10;
        dirLight.shadow.camera.bottom = -10;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        this.scene.add(dirLight);

        // Fill light
        const fillLight = new THREE.DirectionalLight(0x4488ff, 0.3);
        fillLight.position.set(-5, 5, -5);
        this.scene.add(fillLight);

        // Point light for highlights
        const pointLight = new THREE.PointLight(0xffffff, 0.5, 10);
        pointLight.position.set(0, 3, 0);
        this.scene.add(pointLight);
    }

    setupControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 2;
        this.controls.maxDistance = 20;
        this.controls.enablePan = true;
        this.controls.autoRotate = false;
        this.controls.autoRotateSpeed = 1.0;
    }

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);

        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);

        const bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.5,  // Bloom strength
            0.4,  // Bloom radius
            0.85  // Bloom threshold
        );
        this.composer.addPass(bloomPass);
    }

    setupUIControls() {
        // Speed control
        const speedSlider = document.getElementById('speed-slider');
        const speedValue = document.getElementById('speed-value');

        speedSlider.addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            this.molecularSystem.set_animation_speed(speed);
            speedValue.textContent = speed.toFixed(1) + 'x';
        });

        // Quality control
        const qualitySelect = document.getElementById('quality-select');
        qualitySelect.addEventListener('change', (e) => {
            this.currentQuality = e.target.value;
            this.rebuildMolecule();
        });

        // Keyboard controls
        window.addEventListener('keydown', (e) => {
            switch(e.key) {
                case ' ':
                    this.controls.autoRotate = !this.controls.autoRotate;
                    break;
                case 'r':
                    this.resetCamera();
                    break;
            }
        });
    }

    createAtomMesh(position, radius, color) {
        const quality = this.qualitySettings[this.currentQuality];
        const geometry = new THREE.SphereGeometry(radius, quality.sphereSegments, quality.sphereSegments);

        const material = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(...color),
            metalness: 0.2,
            roughness: 0.3,
            clearcoat: 0.3,
            clearcoatRoughness: 0.25,
            envMapIntensity: 1,
            transparent: true,
            opacity: 0.95
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...position);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Add glow sphere
        const glowGeometry = new THREE.SphereGeometry(radius * 1.2, 16, 16);
        const glowMaterial = new THREE.MeshBasicMaterial({
            color: new THREE.Color(...color),
            transparent: true,
            opacity: 0.1,
            side: THREE.BackSide
        });
        const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
        mesh.add(glowMesh);

        return mesh;
    }

    createBondMesh(start, end, radius, color) {
        const quality = this.qualitySettings[this.currentQuality];

        // Calculate bond orientation
        const startVec = new THREE.Vector3(...start);
        const endVec = new THREE.Vector3(...end);
        const direction = new THREE.Vector3().subVectors(endVec, startVec);
        const length = direction.length();
        const center = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);

        // Create cylinder
        const geometry = new THREE.CylinderGeometry(
            radius, radius, length,
            quality.cylinderSegments, 1, false
        );

        const material = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(...color),
            metalness: 0.4,
            roughness: 0.4,
            clearcoat: 0.2,
            clearcoatRoughness: 0.3
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(center);

        // Orient cylinder to connect atoms
        mesh.lookAt(endVec);
        mesh.rotateX(Math.PI / 2);

        mesh.castShadow = true;
        mesh.receiveShadow = true;

        return mesh;
    }

    updateMolecule() {
        // Get atom data from WASM
        const atoms = [];
        const atomCount = this.molecularSystem.get_atom_count();

        for (let i = 0; i < atomCount; i++) {
            const atom = this.molecularSystem.get_atom_data(i);
            if (atom) {
                atoms.push({
                    position: [atom.x, atom.y, atom.z],
                    radius: atom.radius,
                    color: atom.element === 0 ? [1, 1, 1] : [0.2, 0.8, 0.3]
                });
            }
        }

        // Get bond data from WASM
        const bonds = [];
        const bondCount = this.molecularSystem.get_bond_count();

        for (let i = 0; i < bondCount; i++) {
            const bond = this.molecularSystem.get_bond_data(i);
            if (bond) {
                bonds.push({
                    start: [bond.start_x, bond.start_y, bond.start_z],
                    end: [bond.end_x, bond.end_y, bond.end_z],
                    radius: 0.1,
                    color: [0.7, 0.7, 0.7]
                });
            }
        }

        // Update or create atom meshes
        atoms.forEach((atom, i) => {
            if (this.atomMeshes[i]) {
                // Update position for animation
                this.atomMeshes[i].position.set(...atom.position);
            } else {
                // Create new mesh
                const mesh = this.createAtomMesh(atom.position, atom.radius, atom.color);
                this.scene.add(mesh);
                this.atomMeshes.push(mesh);
            }
        });

        // Update or create bond meshes
        bonds.forEach((bond, i) => {
            if (this.bondMeshes[i]) {
                // Remove old bond and create new one with updated position
                this.scene.remove(this.bondMeshes[i]);
                this.bondMeshes[i].geometry.dispose();
                this.bondMeshes[i].material.dispose();

                const mesh = this.createBondMesh(bond.start, bond.end, bond.radius, bond.color);
                this.scene.add(mesh);
                this.bondMeshes[i] = mesh;
            } else {
                // Create new mesh
                const mesh = this.createBondMesh(bond.start, bond.end, bond.radius, bond.color);
                this.scene.add(mesh);
                this.bondMeshes.push(mesh);
            }
        });
    }

    rebuildMolecule() {
        // Clear existing meshes
        this.atomMeshes.forEach(mesh => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        });
        this.bondMeshes.forEach(mesh => {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        });

        this.atomMeshes = [];
        this.bondMeshes = [];

        // Rebuild with new quality
        this.updateMolecule();
    }

    resetCamera() {
        this.camera.position.set(0, 2, 5);
        this.camera.lookAt(0, 0, 0);
        this.controls.reset();
    }

    handleResize() {
        const resize = () => {
            const width = window.innerWidth;
            const height = window.innerHeight;

            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();

            this.renderer.setSize(width, height);
            this.composer.setSize(width, height);
        };

        resize();
        window.addEventListener('resize', resize);
    }

    animate() {
        const clock = new THREE.Clock();

        const animationLoop = () => {
            requestAnimationFrame(animationLoop);

            const deltaTime = clock.getDelta();

            // Update molecular system
            this.molecularSystem.update(deltaTime);

            // Update molecule visualization
            this.updateMolecule();

            // Update controls
            this.controls.update();

            // Render
            this.composer.render();
        };

        animationLoop();
    }
}

// Initialize application
const app = new MolecularVisualization();
app.init().catch(console.error);
