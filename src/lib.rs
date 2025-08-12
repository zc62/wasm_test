use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct MolecularSystem {
    time: f32,
    animation_speed: f32,
}

#[wasm_bindgen]
pub struct AtomData {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub element: u32, // 0 = H, 1 = F
    pub radius: f32,
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

#[wasm_bindgen]
impl MolecularSystem {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        MolecularSystem {
            time: 0.0,
            animation_speed: 1.0,
        }
    }

    pub fn update(&mut self, delta_time: f32) {
        self.time += delta_time * self.animation_speed;
    }

    pub fn get_atom_count(&self) -> usize {
        2 // HF has 2 atoms
    }

    pub fn get_atom_data(&self, index: usize) -> Option<AtomData> {
        // HF molecule configurations for vibration animation
        // Frame 1: Normal bond length (0.92 Å)
        // Frame 2: Stretched bond (1.1 Å)

        let t = (self.time.sin() + 1.0) * 0.5; // Oscillate between 0 and 1

        match index {
            0 => {
                // Hydrogen atom
                Some(AtomData {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                    element: 0,
                    radius: 0.25,
                })
            }
            1 => {
                // Fluorine atom - animate position for bond stretching
                let base_distance = 0.92;
                let stretch_amount = 0.18;
                let distance = base_distance + stretch_amount * t;

                Some(AtomData {
                    x: distance,
                    y: 0.0,
                    z: 0.0,
                    element: 1,
                    radius: 0.35,
                })
            }
            _ => None
        }
    }

    pub fn get_bond_count(&self) -> usize {
        1 // Single bond in HF
    }

    pub fn get_bond_data(&self, index: usize) -> Option<BondData> {
        if index == 0 {
            let h_atom = self.get_atom_data(0)?;
            let f_atom = self.get_atom_data(1)?;

            Some(BondData {
                start_x: h_atom.x,
                start_y: h_atom.y,
                start_z: h_atom.z,
                end_x: f_atom.x,
                end_y: f_atom.y,
                end_z: f_atom.z,
            })
        } else {
            None
        }
    }

    pub fn set_animation_speed(&mut self, speed: f32) {
        self.animation_speed = speed;
    }
}

#[wasm_bindgen(start)]
pub fn main() {
    // Initialize panic hook for better error messages
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}
