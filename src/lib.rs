use wasm_bindgen::prelude::*;
use js_sys::{Float32Array, Uint16Array};

#[wasm_bindgen]
pub fn get_positions() -> Float32Array {
    // Water: O at origin; two Hs in XZ plane
    let bond = 0.9572_f32;
    let angle_deg = 104.45_f32;
    let half = (angle_deg / 2.0).to_radians();

    let x1 = bond * half.sin();
    let z1 = bond * half.cos();
    let x2 = -x1;
    let z2 = z1;

    let pts: Vec<f32> = vec![
        0.0, 0.0, 0.0,   // O
        x1,  0.0, z1,    // H1
        x2,  0.0, z2,    // H2
    ];
    Float32Array::from(pts.as_slice())
}

#[wasm_bindgen]
pub fn get_radii() -> Float32Array {
    // display radii (arbitrary, Å units)
    let radii: Vec<f32> = vec![0.6, 0.25, 0.25];
    Float32Array::from(radii.as_slice())
}

#[wasm_bindgen]
pub fn get_colors() -> Float32Array {
    // r,g,b per atom (0..1)
    let cols: Vec<f32> = vec![
        1.0, 0.2, 0.1, // O (reddish)
        1.0, 1.0, 1.0, // H1
        1.0, 1.0, 1.0, // H2
    ];
    Float32Array::from(cols.as_slice())
}

#[wasm_bindgen]
pub fn get_bonds() -> Uint16Array {
    let bonds: Vec<u16> = vec![0, 1, 0, 2];
    Uint16Array::from(bonds.as_slice())
}

