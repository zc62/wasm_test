import init, { MolecularSystem } from '../pkg/webgpu_molecular_viz.js';
import { WebGPURenderer } from './webgpu-renderer.js';

async function main() {
    // Initialize WASM module
    await init();

    // Create molecular system
    const molecularSystem = new MolecularSystem();

    // Initialize WebGPU renderer
    const canvas = document.getElementById('canvas');
    const renderer = new WebGPURenderer(canvas);
    await renderer.initialize();

    // Setup controls
    const speedSlider = document.getElementById('speed-slider');
    const speedValue = document.getElementById('speed-value');

    speedSlider.addEventListener('input', (e) => {
        const speed = parseFloat(e.target.value);
        molecularSystem.set_animation_speed(speed);
        speedValue.textContent = speed.toFixed(1) + 'x';
    });

    // Animation loop
    let lastTime = performance.now();

    function animate(currentTime) {
        const deltaTime = (currentTime - lastTime) / 1000;
        lastTime = currentTime;

        // Update molecular system
        molecularSystem.update(deltaTime);

        // Get atom and bond data
        const atoms = [];
        const atomCount = molecularSystem.get_atom_count();
        for (let i = 0; i < atomCount; i++) {
            const atom = molecularSystem.get_atom_data(i);
            if (atom) {
                atoms.push({
                    position: [atom.x, atom.y, atom.z],
                    radius: atom.radius,
                    color: atom.element === 0 ? [1, 1, 1] : [0.2, 0.8, 0.3] // H=white, F=green
                });
            }
        }

        const bonds = [];
        const bondCount = molecularSystem.get_bond_count();
        for (let i = 0; i < bondCount; i++) {
            const bond = molecularSystem.get_bond_data(i);
            if (bond) {
                bonds.push({
                    start: [bond.start_x, bond.start_y, bond.start_z],
                    end: [bond.end_x, bond.end_y, bond.end_z],
                    radius: 0.1,
                    color: [0.7, 0.7, 0.7]
                });
            }
        }

        // Render frame
        renderer.render(atoms, bonds);

        requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
}

main().catch(console.error);
