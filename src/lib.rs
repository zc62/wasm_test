use wasm_bindgen::prelude::*;
use web_sys::console;

// Macro for console logging
macro_rules! log {
    ( $( $t:tt )* ) => {
        console::log_1(&format!( $( $t )* ).into());
    }
}

#[wasm_bindgen]
pub struct Camera {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub target_x: f32,
    pub target_y: f32,
    pub target_z: f32,
}

#[wasm_bindgen]
impl Camera {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Camera {
            x: 0.0, y: 2.0, z: 5.0,
            target_x: 0.0, target_y: 0.0, target_z: 0.0,
        }
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct AtomData {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub element: u32,
    pub radius: f32,
    pub lod_level: u32,
}

// Raw atom storage - simulates file data
#[derive(Clone, Copy)]
struct RawAtom {
    x: f32,
    y: f32,
    z: f32,
    element: u32,
}

#[wasm_bindgen]
pub struct MolecularSystem {
    // ALL atoms stored here - simulates loaded file data
    all_atoms: Vec<RawAtom>,
    total_atom_count: usize,
    grid_size: f32,
    time: f32,
    animation_speed: f32,

    // Camera-dependent data - recalculated on every camera change
    current_camera_hash: u64,
    cached_visible_atoms: Vec<AtomData>,
}

#[wasm_bindgen]
impl MolecularSystem {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        MolecularSystem {
            all_atoms: Vec::new(),
            total_atom_count: 0,
            grid_size: 1.0,
            time: 0.0,
            animation_speed: 1.0,
            current_camera_hash: 0,
            cached_visible_atoms: Vec::new(),
        }
    }

    /// Simulate loading atoms from file - READ ALL ATOMS FIRST
    pub fn load_atoms_from_file(&mut self, count: usize) {
        log!("Loading {} atoms from file (simulated)...", count);

        self.total_atom_count = count;
        self.all_atoms.clear();
        self.all_atoms.reserve(count);

        // Step 1: READ ALL ATOMS (simulate file reading)
        // Generate simple coordinates - treat this as unknown data source
        self.read_all_atoms_from_source(count);

        // Step 2: Analyze the complete dataset
        self.analyze_complete_dataset();

        // Clear any cached camera-dependent data
        self.invalidate_camera_cache();

        log!("Loaded {} atoms from file", self.all_atoms.len());
    }

    /// Simulate reading from an actual file source
    fn read_all_atoms_from_source(&mut self, count: usize) {
        // This simulates reading ALL atoms from a file
        // The implementation treats these coordinates as UNKNOWN/EXTERNAL

        if count <= 2 {
            // Special case: HF molecule
            self.all_atoms.push(RawAtom { x: 0.0, y: 0.0, z: 0.0, element: 0 }); // H
            if count > 1 {
                self.all_atoms.push(RawAtom { x: 0.92, y: 0.0, z: 0.0, element: 1 }); // F
            }
            return;
        }

        // For larger counts, generate coordinates (simulating file data)
        let atoms_per_axis = ((count as f32).powf(1.0/3.0).ceil() as usize).max(1);
        let spacing = self.grid_size;
        let offset = -(atoms_per_axis as f32 - 1.0) * spacing * 0.5;

        log!("Reading atoms in {}x{}x{} grid from file...", atoms_per_axis, atoms_per_axis, atoms_per_axis);

        // Read ALL atoms - this would be a file read in real implementation
        for i in 0..count {
            let x_idx = i % atoms_per_axis;
            let y_idx = (i / atoms_per_axis) % atoms_per_axis;
            let z_idx = i / (atoms_per_axis * atoms_per_axis);

            let x = offset + x_idx as f32 * spacing;
            let y = offset + y_idx as f32 * spacing;
            let z = offset + z_idx as f32 * spacing;

            let element = match i % 4 {
                0 => 0, // H
                1 => 1, // F
                2 => 2, // O
                _ => 3, // N
            };

            self.all_atoms.push(RawAtom { x, y, z, element });
        }
    }

    /// Analyze the complete dataset to understand atom distribution
    fn analyze_complete_dataset(&self) {
        log!("Analyzing complete dataset of {} atoms...", self.all_atoms.len());

        if self.all_atoms.is_empty() {
            return;
        }

        // Calculate bounding box by iterating ALL atoms
        let mut min_x = f32::INFINITY;
        let mut max_x = f32::NEG_INFINITY;
        let mut min_y = f32::INFINITY;
        let mut max_y = f32::NEG_INFINITY;
        let mut min_z = f32::INFINITY;
        let mut max_z = f32::NEG_INFINITY;

        // MUST iterate through ALL atoms to understand the data
        for atom in &self.all_atoms {
            min_x = min_x.min(atom.x);
            max_x = max_x.max(atom.x);
            min_y = min_y.min(atom.y);
            max_y = max_y.max(atom.y);
            min_z = min_z.min(atom.z);
            max_z = max_z.max(atom.z);
        }

        let bounds_x = max_x - min_x;
        let bounds_y = max_y - min_y;
        let bounds_z = max_z - min_z;

        log!("Dataset bounds: X:{:.2}-{:.2}, Y:{:.2}-{:.2}, Z:{:.2}-{:.2}",
             min_x, max_x, min_y, max_y, min_z, max_z);
        log!("Dataset size: {:.2} x {:.2} x {:.2}", bounds_x, bounds_y, bounds_z);
    }

    /// Get atoms visible from current camera - RECALCULATE ON EVERY CAMERA CHANGE
    pub fn get_visible_atoms_for_camera(&mut self, camera: &Camera, fov: f32, aspect: f32, near: f32, far: f32) -> Vec<AtomData> {
        // Calculate camera hash to detect changes
        let camera_hash = self.calculate_camera_hash(camera, fov, aspect, near, far);

        // If camera changed, MUST recalculate everything
        if camera_hash != self.current_camera_hash {
            log!("Camera changed - recalculating LOD for ALL {} atoms", self.all_atoms.len());

            self.current_camera_hash = camera_hash;
            self.cached_visible_atoms.clear();

            // Recalculate visibility and LOD for ALL atoms from new camera position
            self.recalculate_visibility_for_camera(camera, fov, aspect, near, far);
        }

        self.cached_visible_atoms.clone()
    }

    /// Recalculate atom visibility and LOD from current camera position
    fn recalculate_visibility_for_camera(&mut self, camera: &Camera, fov: f32, _aspect: f32, _near: f32, far: f32) {
        let cam_pos = (camera.x, camera.y, camera.z);
        let cam_target = (camera.target_x, camera.target_y, camera.target_z);

        // Calculate aggressive distance thresholds based on total atom count
        let aggression = self.calculate_aggression_factor();
        let max_distance = far * 0.8;
        let point_threshold = 50.0 * aggression;
        let low_poly_threshold = 20.0 * aggression;
        let medium_poly_threshold = 10.0 * aggression;

        // Calculate view direction for frustum culling
        let view_dir = (
            cam_target.0 - cam_pos.0,
            cam_target.1 - cam_pos.1,
            cam_target.2 - cam_pos.2,
        );
        let view_length = (view_dir.0*view_dir.0 + view_dir.1*view_dir.1 + view_dir.2*view_dir.2).sqrt();
        let view_normalized = if view_length > 0.0 {
            (view_dir.0/view_length, view_dir.1/view_length, view_dir.2/view_length)
        } else {
            (0.0, 0.0, -1.0)
        };

        let mut visible_atoms = Vec::new();

        // ITERATE THROUGH ALL ATOMS - essential for rotation handling
        for atom in &self.all_atoms {
            let dx = atom.x - cam_pos.0;
            let dy = atom.y - cam_pos.1;
            let dz = atom.z - cam_pos.2;
            let distance = (dx*dx + dy*dy + dz*dz).sqrt();

            // Natural distance culling based on camera far plane
            if distance > max_distance {
                continue;
            }

            // Natural frustum culling
            let to_atom_length = distance;
            if to_atom_length > 0.0 {
                let to_atom_normalized = (dx/to_atom_length, dy/to_atom_length, dz/to_atom_length);
                let dot_product = view_normalized.0 * to_atom_normalized.0 +
                                view_normalized.1 * to_atom_normalized.1 +
                                view_normalized.2 * to_atom_normalized.2;

                // Cull atoms outside expanded view frustum
                let fov_threshold = (fov * 0.6).cos(); // Slightly wider than actual FOV
                if dot_product < fov_threshold {
                    continue;
                }
            }

            // Calculate LOD based on distance and aggression - this is the MAIN performance control
            let lod_level = if distance > point_threshold {
                0 // Point representation - very cheap to render
            } else if distance > low_poly_threshold {
                1 // Low-poly sphere - moderate cost
            } else if distance > medium_poly_threshold {
                2 // Medium-poly sphere - higher cost
            } else {
                3 // High-poly sphere - expensive, but few atoms will be this close
            };

            // Element-specific radius
            let base_radius = match atom.element {
                0 => 0.25, // H
                1 => 0.35, // F
                2 => 0.3,  // O
                _ => 0.28, // N
            };

            // Animate radius slightly
            let animated_radius = base_radius + 0.02 * (self.time + atom.x + atom.y + atom.z).sin();

            visible_atoms.push(AtomData {
                x: atom.x,
                y: atom.y,
                z: atom.z,
                element: atom.element,
                radius: animated_radius,
                lod_level,
            });
        }

        self.cached_visible_atoms = visible_atoms;

        log!("Selected {} visible atoms from {} total (aggression: {:.1}x) - LOD naturally applied",
             self.cached_visible_atoms.len(), self.all_atoms.len(), aggression);
    }

    fn calculate_aggression_factor(&self) -> f32 {
        // More aggressive culling for larger atom counts
        match self.total_atom_count {
            0..=1_000 => 1.0,
            1_001..=10_000 => 2.0,
            10_001..=100_000 => 4.0,
            100_001..=1_000_000 => 8.0,
            1_000_001..=10_000_000 => 16.0,
            _ => 32.0,
        }
    }

    fn calculate_camera_hash(&self, camera: &Camera, fov: f32, _aspect: f32, _near: f32, _far: f32) -> u64 {
        // Simple hash to detect camera changes
        let mut hash = 0u64;
        hash ^= (camera.x * 1000.0) as u64;
        hash ^= ((camera.y * 1000.0) as u64) << 10;
        hash ^= ((camera.z * 1000.0) as u64) << 20;
        hash ^= ((camera.target_x * 1000.0) as u64) << 30;
        hash ^= ((camera.target_y * 1000.0) as u64) << 40;
        hash ^= ((camera.target_z * 1000.0) as u64) << 50;
        hash ^= (fov * 100.0) as u64;
        hash
    }

    fn invalidate_camera_cache(&mut self) {
        self.current_camera_hash = 0;
        self.cached_visible_atoms.clear();
    }

    /// Get raw atom data for WebGPU compute shaders
    pub fn get_all_atom_positions(&self) -> Vec<f32> {
        let mut positions = Vec::new();
        positions.reserve(self.all_atoms.len() * 4); // x, y, z, element

        for atom in &self.all_atoms {
            positions.push(atom.x);
            positions.push(atom.y);
            positions.push(atom.z);
            positions.push(atom.element as f32);
        }

        positions
    }

    /// Get coarse spatial chunks for WebGPU processing
    pub fn get_spatial_chunks(&self, chunk_size: f32) -> Vec<f32> {
        if self.all_atoms.is_empty() {
            return Vec::new();
        }

        // Calculate spatial bounds
        let mut min_pos = (f32::INFINITY, f32::INFINITY, f32::INFINITY);
        let mut max_pos = (f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);

        for atom in &self.all_atoms {
            min_pos.0 = min_pos.0.min(atom.x);
            min_pos.1 = min_pos.1.min(atom.y);
            min_pos.2 = min_pos.2.min(atom.z);
            max_pos.0 = max_pos.0.max(atom.x);
            max_pos.1 = max_pos.1.max(atom.y);
            max_pos.2 = max_pos.2.max(atom.z);
        }

        // Create spatial chunks
        let chunks_per_axis = ((max_pos.0 - min_pos.0) / chunk_size).ceil().max(1.0) as usize;
        let mut chunks = Vec::new();

        for x in 0..chunks_per_axis {
            for y in 0..chunks_per_axis {
                for z in 0..chunks_per_axis {
                    let center_x = min_pos.0 + (x as f32 + 0.5) * chunk_size;
                    let center_y = min_pos.1 + (y as f32 + 0.5) * chunk_size;
                    let center_z = min_pos.2 + (z as f32 + 0.5) * chunk_size;

                    // Count atoms in this chunk
                    let mut atom_count = 0;
                    for atom in &self.all_atoms {
                        let dx = (atom.x - center_x).abs();
                        let dy = (atom.y - center_y).abs();
                        let dz = (atom.z - center_z).abs();

                        if dx <= chunk_size * 0.5 && dy <= chunk_size * 0.5 && dz <= chunk_size * 0.5 {
                            atom_count += 1;
                        }
                    }

                    if atom_count > 0 {
                        chunks.push(center_x);      // chunk center x
                        chunks.push(center_y);      // chunk center y
                        chunks.push(center_z);      // chunk center z
                        chunks.push(chunk_size);    // chunk size
                        chunks.push(atom_count as f32); // atom count
                        chunks.push(0.0);           // reserved
                        chunks.push(0.0);           // reserved
                        chunks.push(0.0);           // reserved
                    }
                }
            }
        }

        chunks
    }

    pub fn update(&mut self, delta_time: f32) {
        self.time += delta_time * self.animation_speed;

        // Animation changes require camera cache invalidation
        self.invalidate_camera_cache();
    }

    pub fn get_total_atom_count(&self) -> usize {
        self.total_atom_count
    }

    pub fn set_animation_speed(&mut self, speed: f32) {
        self.animation_speed = speed;
    }

    pub fn set_grid_size(&mut self, size: f32) {
        self.grid_size = size;
        // Regenerate atoms with new spacing
        let count = self.total_atom_count;
        self.load_atoms_from_file(count);
    }

    // Legacy compatibility
    pub fn generate_atoms(&mut self, count: usize) {
        self.load_atoms_from_file(count);
    }

    pub fn cull_and_lod(&mut self, camera: &Camera, fov: f32, aspect: f32, near: f32, far: f32) -> Vec<AtomData> {
        self.get_visible_atoms_for_camera(camera, fov, aspect, near, far)
    }

    // Legacy methods for small molecules
    pub fn get_atom_count(&self) -> usize {
        if self.total_atom_count <= 2 { self.total_atom_count } else { 0 }
    }

    pub fn get_atom_data(&self, index: usize) -> Option<AtomData> {
        if self.total_atom_count <= 2 && index < self.all_atoms.len() {
            let atom = self.all_atoms[index];
            let animated_offset = if index == 1 {
                0.18 * (self.time.sin() + 1.0) * 0.5
            } else { 0.0 };

            Some(AtomData {
                x: atom.x + animated_offset,
                y: atom.y,
                z: atom.z,
                element: atom.element,
                radius: if atom.element == 0 { 0.25 } else { 0.35 },
                lod_level: 3,
            })
        } else {
            None
        }
    }

    pub fn get_bond_count(&self) -> usize {
        if self.total_atom_count <= 2 { 1 } else { 0 }
    }

    pub fn get_bond_data(&self, index: usize) -> Option<BondData> {
        if self.total_atom_count <= 2 && index == 0 {
            let h_atom = self.get_atom_data(0)?;
            let f_atom = self.get_atom_data(1)?;
            Some(BondData {
                start_x: h_atom.x, start_y: h_atom.y, start_z: h_atom.z,
                end_x: f_atom.x, end_y: f_atom.y, end_z: f_atom.z,
            })
        } else {
            None
        }
    }
}

#[wasm_bindgen]
pub struct BondData {
    pub start_x: f32,
    pub start_y: f32,
    pub start_z: f32,
    pub end_x: f32,
    pub end_y: f32,
    pub end_z: f32,
}

#[wasm_bindgen(start)]
pub fn main() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();

    log!("Enhanced molecular visualization WASM initialized - with file reading simulation and rotation-aware LOD");
}
