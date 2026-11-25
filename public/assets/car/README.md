# assets/car — hero car

`muscle-grab3d.glb` — CC0-1.0. "Muscle Car" from the Cozy Cars kit.
Source page: https://grab3d.com/models/vehicles/muscle-car/
Direct download: https://grab3d.com/dl/muscle-car/muscle-car.glb
19,806 triangles, 6 meshes, 18 glTF materials, 2K PBR maps, 4.68 x 1.92 x 1.39 m,
nose +Z in file space (front wheels at z = +1.52, rear at z = -1.34), no required
glTF extensions so it loads without a loader package or a KTX2/meshopt decoder.

`body_basecolor_black.jpg` — derivative of the GLB's own body albedo atlas,
1024 px, generated offline: every yellow/ochre paint island is remapped to a
near-black with a warm cast while keeping its baked shading, and the bright
neutral islands (chrome strips, lamp reflectors) are knocked down to satin steel.
Lamp, grille and trim islands keep their original hue. The reference car is a
plain black car; the stock atlas is butter yellow with racing stripes.

Unused but left in place: `ferrari458.glb`, `toycar.glb` (fallbacks supplied by
the integrator, not referenced by `lab/src/parts/car.ts`).
