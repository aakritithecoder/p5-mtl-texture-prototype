/**
 * mtl-loader.js
 * 
 * Prototype patch for p5.js's MTL parsing + rendering pipeline.
 * 
 * In the real GSoC implementation, this logic integrates into:
 *   src/webgl/loading.js  → parseMtl() extended with texture map support
 *   src/webgl/p5.Geometry.js → new `materials` and `materialIndices` arrays
 *   src/webgl/p5.RendererGL.js → drawModelWithMaterials() multi-pass rendering
 * 
 * Author: aakritithecoder (GSoC 2026 Proposal Prototype)
 */

// ─────────────────────────────────────────────────────────────────────────────
// DATA STRUCTURE
// This is the proposed MaterialDefinition object.
// p5.Geometry would gain a `materials` array of these,
// plus a `materialIndices` Int16Array (one entry per face).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an empty MaterialDefinition with sensible defaults.
 * Mirrors the MTL specification properties we care about.
 * 
 * @param {string} name - The material name from the `newmtl` directive
 * @returns {Object} A MaterialDefinition object
 */
function createMaterialDefinition(name) {
  return {
    name: name,

    // ── Scalar / color properties ──────────────────────────────────────────
    ambient:   [0.2, 0.2, 0.2],   // Ka — ambient color
    diffuse:   [0.8, 0.8, 0.8],   // Kd — diffuse color (used as fallback)
    specular:  [0.0, 0.0, 0.0],   // Ks — specular color
    emissive:  [0.0, 0.0, 0.0],   // Ke — emissive color
    shininess: 10.0,               // Ns — specular exponent
    opacity:   1.0,                // d  — dissolve / alpha

    // ── Texture map paths (raw strings from .mtl file) ─────────────────────
    // These are set during parsing, then replaced with p5.Image objects
    diffuseMapPath:   null,   // map_Kd
    ambientMapPath:   null,   // map_Ka
    specularMapPath:  null,   // map_Ks
    shininessMapPath: null,   // map_Ns
    opacityMapPath:   null,   // map_d
    bumpMapPath:      null,   // map_Bump
    normalMapPath:    null,   // norm

    // ── Loaded p5.Image objects (populated in loadMTLWithTextures) ─────────
    diffuseMap:   null,
    ambientMap:   null,
    specularMap:  null,
    shininessMap: null,
    opacityMap:   null,
    bumpMap:      null,
    normalMap:    null,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: MTL PARSER (extended from p5.js's current parseMtl)
//
// Current p5.js parseMtl() only handles:  newmtl, Kd (as solid color), d, Ks
// This extended version adds:  map_Kd, map_Ka, map_Ks, map_Ns, map_d,
//                              map_Bump, norm, Ka, Ke, Ns, Tf
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses a .mtl file string into an array of MaterialDefinition objects.
 * All texture paths are stored as strings; textures are not yet loaded here.
 * 
 * @param {string} mtlText  - Raw text content of the .mtl file
 * @param {string} mtlPath  - Path to the .mtl file, used for resolving relative texture paths
 * @returns {Object}        - { materials: MaterialDefinition[], nameToIndex: Object }
 */
function parseMTL(mtlText, mtlPath) {
  const materials = [];
  const nameToIndex = {};
  let current = null;

  // Base directory of the MTL file — needed to resolve relative texture paths
  const mtlDir = mtlPath.substring(0, mtlPath.lastIndexOf('/') + 1);

  const lines = mtlText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;  // skip blanks and comments

    const tokens = line.split(/\s+/);
    const directive = tokens[0].toLowerCase();

    switch (directive) {

      // ── New material declaration ─────────────────────────────────────────
      case 'newmtl':
        current = createMaterialDefinition(tokens[1]);
        nameToIndex[tokens[1]] = materials.length;
        materials.push(current);
        break;

      // ── Scalar color properties ──────────────────────────────────────────
      case 'ka':
        if (current) current.ambient = [parseFloat(tokens[1]), parseFloat(tokens[2]), parseFloat(tokens[3])];
        break;
      case 'kd':
        if (current) current.diffuse = [parseFloat(tokens[1]), parseFloat(tokens[2]), parseFloat(tokens[3])];
        break;
      case 'ks':
        if (current) current.specular = [parseFloat(tokens[1]), parseFloat(tokens[2]), parseFloat(tokens[3])];
        break;
      case 'ke':
        if (current) current.emissive = [parseFloat(tokens[1]), parseFloat(tokens[2]), parseFloat(tokens[3])];
        break;
      case 'ns':
        if (current) current.shininess = parseFloat(tokens[1]);
        break;
      case 'd':
        if (current) current.opacity = parseFloat(tokens[1]);
        break;
      case 'tr':
        // Tr is 1 - d (some exporters use Tr instead of d)
        if (current) current.opacity = 1.0 - parseFloat(tokens[1]);
        break;

      // ── Texture maps — THE KEY NEW FUNCTIONALITY ─────────────────────────
      // Each texture path is resolved relative to the MTL file's directory.
      // We store the full resolved path so loadImage() can find it.

      case 'map_kd':
        // Diffuse texture map — the most important one
        // Some exporters add flags before the filename (e.g. -bm 1.0 texture.png)
        // We take the last token as the filename to handle this.
        if (current) {
          const texPath = resolvePath(mtlDir, lastToken(tokens));
          current.diffuseMapPath = texPath;
          console.log(`[MTL Parser] Found map_Kd: "${texPath}" for material "${current.name}"`);
        }
        break;

      case 'map_ka':
        if (current) current.ambientMapPath = resolvePath(mtlDir, lastToken(tokens));
        break;

      case 'map_ks':
        if (current) current.specularMapPath = resolvePath(mtlDir, lastToken(tokens));
        break;

      case 'map_ns':
        if (current) current.shininessMapPath = resolvePath(mtlDir, lastToken(tokens));
        break;

      case 'map_d':
        if (current) current.opacityMapPath = resolvePath(mtlDir, lastToken(tokens));
        break;

      case 'map_bump':
      case 'bump':
        if (current) current.bumpMapPath = resolvePath(mtlDir, lastToken(tokens));
        break;

      case 'norm':
        if (current) current.normalMapPath = resolvePath(mtlDir, lastToken(tokens));
        break;

      // Directives we know about but don't implement in this prototype:
      case 'illum':
      case 'tf':
      case 'ni':
        break;

      default:
        // Unknown directive — silently ignore (matches p5.js's current behaviour)
        break;
    }
  }

  return { materials, nameToIndex };
}

/**
 * Resolves a texture filename relative to the MTL file's directory.
 * Handles Windows-style backslashes in paths from some exporters.
 * 
 * @param {string} baseDir - Directory of the .mtl file (e.g. 'assets/')
 * @param {string} texFile - Texture filename from the .mtl (e.g. 'textures/wood.png')
 * @returns {string} Full resolved path
 */
function resolvePath(baseDir, texFile) {
  // Normalise Windows backslashes
  const normalised = texFile.replace(/\\/g, '/');
  // If it's already absolute, don't prepend baseDir
  if (normalised.startsWith('/') || normalised.startsWith('http')) {
    return normalised;
  }
  return baseDir + normalised;
}

/** Returns the last token — handles MTL map directives that may have flags */
function lastToken(tokens) {
  return tokens[tokens.length - 1];
}


// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: ASYNC TEXTURE LOADING
//
// This runs inside p5.js's preload() lifecycle.
// In the real implementation, loadModel() calls this automatically.
// Key insight: we deduplicate paths so shared textures are only loaded once.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads an MTL file, parses it, then async-loads all referenced textures
 * using p5.loadImage() (preload-safe). Returns the materials array.
 * 
 * @param {string} mtlPath - Path to the .mtl file
 * @returns {Object[]}     - Array of MaterialDefinition objects with .diffuseMap etc. populated
 */
function loadMTLWithTextures(mtlPath) {
  // We return a container object immediately; p5's preload system
  // will wait for all loadImage() calls to resolve before setup() runs.
  const container = { materials: [] };

  loadStrings(mtlPath, (lines) => {
    const mtlText = lines.join('\n');
    const { materials } = parseMTL(mtlText, mtlPath);
    container.materials = materials;

    // ── Deduplicate texture paths before loading ───────────────────────────
    // If material A and material B both reference "wood.png", we load it once.
    const pathToImage = {};

    for (const mat of materials) {
      const textureMaps = [
        ['diffuseMapPath',   'diffuseMap'],
        ['ambientMapPath',   'ambientMap'],
        ['specularMapPath',  'specularMap'],
        ['shininessMapPath', 'shininessMap'],
        ['opacityMapPath',   'opacityMap'],
        ['bumpMapPath',      'bumpMap'],
        ['normalMapPath',    'normalMap'],
      ];

      for (const [pathKey, imgKey] of textureMaps) {
        const path = mat[pathKey];
        if (!path) continue;

        if (pathToImage[path]) {
          // Already loading or loaded — share the reference
          mat[imgKey] = pathToImage[path];
          console.log(`[Texture Loader] Reusing cached texture: "${path}"`);
        } else {
          // Load it fresh with graceful error handling
          console.log(`[Texture Loader] Loading texture: "${path}"`);
          const imgRef = { value: null };  // wrapper to allow sharing before load completes
          
          loadImage(
            path,
            (img) => {
              imgRef.value = img;
              mat[imgKey] = img;
              console.log(`[Texture Loader] ✓ Loaded: "${path}"`);
            },
            (err) => {
              // Graceful fallback: texture missing → use Kd solid colour
              console.warn(`[Texture Loader] ⚠ Could not load "${path}" — falling back to Kd color. (${err})`);
              mat[pathKey] = null;  // clear path so renderer uses solid colour
            }
          );
          pathToImage[path] = imgRef;
        }
      }
    }
  });

  return container;
}


// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: MULTI-MATERIAL RENDERER
//
// This is a simplified version of the draw-dispatch logic that would live in
// p5.RendererGL. It iterates through materials, applies the right texture
// or color, and draws the model.
//
// In the full implementation:
//   - Faces are sorted by material index at load time (contiguous face ranges)
//   - A single drawElements call per material using index buffer offsets
//   - Per-material shader uniforms are set via p5.Shader.setUniform()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draws a p5.Geometry model with per-material textures/colors.
 * 
 * This prototype uses p5.js's existing texture() and fill() to demonstrate
 * the per-material switching. The real implementation would use index buffer
 * range draw calls for GPU efficiency.
 * 
 * @param {p5.Geometry} model     - The loaded geometry (from loadModel)
 * @param {Object}      matData   - Container with .materials array from loadMTLWithTextures
 */
function drawModelWithMaterials(model, matData) {
  if (!matData || !matData.materials || matData.materials.length === 0) {
    // No MTL data — fall back to default p5.js rendering
    model(model);
    return;
  }

  const materials = matData.materials;

  for (let i = 0; i < materials.length; i++) {
    const mat = materials[i];

    push();

    // ── Apply diffuse texture or fallback to Kd solid color ───────────────
    if (mat.diffuseMap && mat.diffuseMap.value) {
      // We have a texture! Apply it.
      texture(mat.diffuseMap.value);
      // Tint with diffuse color (multiplied in shader in real implementation)
      tint(255, 255 * mat.opacity);
    } else {
      // No texture loaded — use the Kd solid colour as fallback
      const [r, g, b] = mat.diffuse;
      ambientMaterial(r * 255, g * 255, b * 255);
      tint(255, 255 * mat.opacity);
    }

    // ── Apply specular shininess ───────────────────────────────────────────
    // In the full implementation, specularMap and shininessMap would be
    // uploaded as shader uniforms here.
    shininess(mat.shininess);

    // ── Draw the model ─────────────────────────────────────────────────────
    // NOTE: In the prototype we draw the full model per material pass.
    // The real implementation draws ONLY the face range for this material
    // using drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, byteOffset).
    model(model);

    pop();
  }
}
