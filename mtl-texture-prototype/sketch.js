/**
 * MTL Full Texture Support — Proof of Concept
 * 
 * GSoC 2026 Prototype by: aakritithecoder
 * Project: Full Texture Support for .mtl Files (Processing Foundation)
 *
 * WHAT THIS PROVES:
 * -----------------
 * p5.js currently ignores texture maps in .mtl files (map_Kd, map_Ks, etc.)
 * and only reads solid diffuse colors (Kd). This prototype patches the MTL
 * parsing pipeline to:
 *   1. Parse `map_Kd` directives and resolve their texture file paths
 *   2. Async-load the textures using p5.loadImage() inside preload()
 *   3. Attach loaded p5.Image objects to the material definition
 *   4. Apply the correct texture per face during rendering
 *
 * This is a minimal, self-contained demonstration of the core idea.
 * The full GSoC implementation would extend this to map_Ka, map_Ks,
 * map_Ns, map_d, map_Bump, norm — and handle multi-material models
 * with GPU-efficient face grouping by material index.
 *
 * HOW TO RUN:
 * -----------
 * Open index.html in a browser (needs a local server due to file:// restrictions).
 * Or paste sketch.js into https://editor.p5js.org
 *
 * ASSETS USED:
 * ------------
 * cube.obj + cube.mtl + texture.png  (included in this repo)
 * The cube has 2 faces with different materials — one solid-colored, one textured.
 */

// ─── Our patched MTL loader lives in mtl-loader.js ───
// In a real p5.js PR, this logic would go into src/webgl/loading.js

let myModel;      // The loaded p5.Geometry
let myMaterials;  // Array of MaterialDefinition objects (our new structure)
let angle = 0;

// ─── PRELOAD: load model + textures ───────────────────────────────────────────
function preload() {
  // Step 1: Load the raw OBJ file (p5.js can already parse the geometry)
  myModel = loadModel('assets/cube.obj', true);

  // Step 2: Load our patched MTL data (textures included) via our custom loader
  // In the real implementation, loadModel() would handle this automatically.
  myMaterials = loadMTLWithTextures('assets/cube.mtl');
}

// ─── SETUP ────────────────────────────────────────────────────────────────────
function setup() {
  createCanvas(600, 500, WEBGL);
  noStroke();
  textureMode(NORMAL);
  console.log('Materials loaded:', myMaterials);
}

// ─── DRAW ─────────────────────────────────────────────────────────────────────
function draw() {
  background(30, 30, 40);
  
  // Lighting
  ambientLight(60, 60, 60);
  directionalLight(255, 255, 255, -1, -1, -1);

  // Rotate the cube slowly
  angle += 0.008;
  rotateY(angle);
  rotateX(angle * 0.4);

  // ── Draw the model using our patched multi-material renderer ──
  drawModelWithMaterials(myModel, myMaterials);

  // HUD
  push();
    ortho();
    noLights();
    fill(255, 200);
    noStroke();
    textSize(13);
    textAlign(LEFT);
    text('GSoC 2026 Prototype — Full MTL Texture Support', -290, -230);
    textSize(11);
    fill(180, 220, 255);
    text('map_Kd textures now load & render correctly', -290, -210);
  pop();
}
