// Tunable values for quick iteration.
const INTERNAL_WIDTH = 480;
const INTERNAL_HEIGHT = 270;
const CLEAR_COLOR = new BABYLON.Color4(0.4, 0.4, 0.4, 1);
const FOG_COLOR = new BABYLON.Color3(0.55, 0.55, 0.55);
const FOG_DENSITY = 0.05;
const WALK_SPEED = 3.25;
const RUN_MULTIPLIER = 1.8;
const ROTATION_SPEED = 2.2;
const GRAVITY = 9.81;
const CAMERA_DISTANCE = 6.5;
const CAMERA_HEIGHT = 2.6;
const CAMERA_TARGET_HEIGHT = 1.35;
const CAMERA_LERP = 0.12;
const CAMERA_SENSITIVITY = 0.0026;
const CAMERA_PITCH_LIMIT = 0.45;
const CAMERA_JITTER = 0.01;
const BOB_AMOUNT = 0.06;
const BOB_SPEED = 7.5;
const ROAD_LENGTH = 50;
const ROAD_WIDTH = 12;
const SIDEWALK_WIDTH = 1.2;
const SIDEWALK_HEIGHT = 0.18;
const PLAYER_MAX_HEALTH = 100;
const PLAYER_ATTACK_COOLDOWN = 0.45;
const PLAYER_ATTACK_RANGE = 2.5;
const PLAYER_ATTACK_DAMAGE = 15;
const PLAYER_ATTACK_ANIM = 0.22;
const ENEMY_COUNT = 5;
const ENEMY_BASE_HEALTH = 30;
const ENEMY_SPEED = 1.2;
const ENEMY_ATTACK_RANGE = 1.8;
const ENEMY_ATTACK_DAMAGE = 8;
const ENEMY_ATTACK_COOLDOWN = 1.1;
const ENEMY_DETECTION_RADIUS = 20;
const ENEMY_IDLE_DRIFT = 0.6;
const DEATH_SINK_SPEED = 0.6;
const WEAPONS = {
  bat: { name: "Bat", range: 2.8, damage: 18, cooldown: 0.5, cone: 60 },
  pistol: { name: "Pistol", range: 10, damage: 12, cooldown: 0.6, cone: 20 },
};
const HIT_EFFECT_LIFETIME = 0.25;
const HIT_EFFECT_SIZE = 1.1;

const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, false, {
  antialias: false,
  preserveDrawingBuffer: true,
  stencil: true,
  adaptToDeviceRatio: false,
});

const enemies = [];
const playerState = {
  health: PLAYER_MAX_HEALTH,
  maxHealth: PLAYER_MAX_HEALTH,
  isAlive: true,
  attackCooldown: 0,
  attackRange: PLAYER_ATTACK_RANGE,
  attackDamage: PLAYER_ATTACK_DAMAGE,
  attackAnimTime: 0,
  inventory: ["bat", "pistol"],
  currentWeaponIndex: 0,
};
let hudElements = null;
let hitEffectManager = null;
const hitEffects = [];

engine.resize();
resizeForPixelLook(engine);
const scene = createScene(engine);

engine.runRenderLoop(() => {
  scene.render();
});

window.addEventListener("resize", () => {
  engine.resize();
  resizeForPixelLook(engine);
});

function resizeForPixelLook(targetEngine) {
  const targetCanvas = targetEngine.getRenderingCanvas();
  if (!targetCanvas) return;
  const scaleW = targetCanvas.clientWidth / INTERNAL_WIDTH;
  const scaleH = targetCanvas.clientHeight / INTERNAL_HEIGHT;
  const scale = Math.max(scaleW, scaleH, 1);
  targetEngine.setHardwareScalingLevel(scale);
}

function createScene(targetEngine) {
  const scene = new BABYLON.Scene(targetEngine);
  scene.clearColor = CLEAR_COLOR;
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP;
  scene.fogColor = FOG_COLOR;
  scene.fogDensity = FOG_DENSITY;
  scene.gravity = new BABYLON.Vector3(0, -GRAVITY, 0);
  scene.collisionsEnabled = true;

  // Lights tuned for gloomy early-morning vibes.
  const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), scene);
  hemi.intensity = 0.6;
  hemi.diffuse = new BABYLON.Color3(0.65, 0.65, 0.65);
  hemi.groundColor = new BABYLON.Color3(0.25, 0.25, 0.25);

  const dir = new BABYLON.DirectionalLight("dir", new BABYLON.Vector3(-0.4, -1, -0.4), scene);
  dir.intensity = 0.8;
  dir.position = new BABYLON.Vector3(10, 20, 10);

  createEnvironment(scene);
  const player = createPlayer(scene);
  createEnemies(scene);
  hitEffectManager = createHitEffectManager(scene);
  const cameraRig = setupCamera(scene, player);
  const inputState = setupInput(scene, player, cameraRig);
  hudElements = createHUD();
  updateHUD();
  setupAmbientAudio();

  scene.registerBeforeRender(() => {
    const delta = scene.getEngine().getDeltaTime() / 1000;
    update(scene, player, cameraRig, inputState, delta);
  });

  return scene;
}

function createEnvironment(scene) {
  const asphaltTexture = createAsphaltTexture(scene);
  const sidewalkTexture = createSidewalkTexture(scene);

  const asphaltMaterial = new BABYLON.StandardMaterial("asphaltMat", scene);
  asphaltMaterial.diffuseTexture = asphaltTexture;
  asphaltMaterial.specularColor = BABYLON.Color3.Black();

  const sidewalkMaterial = new BABYLON.StandardMaterial("sidewalkMat", scene);
  sidewalkMaterial.diffuseTexture = sidewalkTexture;
  sidewalkMaterial.specularColor = BABYLON.Color3.Black();

  const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: ROAD_LENGTH, height: ROAD_WIDTH }, scene);
  ground.material = asphaltMaterial;
  ground.checkCollisions = true;

  const leftSidewalk = BABYLON.MeshBuilder.CreateBox(
    "sidewalkLeft",
    { width: ROAD_LENGTH, depth: SIDEWALK_WIDTH, height: SIDEWALK_HEIGHT },
    scene
  );
  leftSidewalk.position = new BABYLON.Vector3(0, SIDEWALK_HEIGHT * 0.5, ROAD_WIDTH * 0.5 + SIDEWALK_WIDTH * 0.5);
  leftSidewalk.material = sidewalkMaterial;
  leftSidewalk.checkCollisions = true;

  const rightSidewalk = leftSidewalk.clone("sidewalkRight");
  rightSidewalk.position.z *= -1;
  rightSidewalk.checkCollisions = true;

  // Invisible blockers keep the player inside the block.
  const barrierMat = new BABYLON.StandardMaterial("barrierMat", scene);
  barrierMat.alpha = 0;
  barrierMat.specularColor = BABYLON.Color3.Black();

  const barrierHeight = 3;
  const barrierDepth = 0.5;
  const leftBarrier = BABYLON.MeshBuilder.CreateBox(
    "barrierLeft",
    { width: ROAD_LENGTH, depth: barrierDepth, height: barrierHeight },
    scene
  );
  leftBarrier.position = new BABYLON.Vector3(0, barrierHeight * 0.5, ROAD_WIDTH * 0.5 + SIDEWALK_WIDTH + barrierDepth * 0.5);
  leftBarrier.isVisible = false;
  leftBarrier.material = barrierMat;
  leftBarrier.checkCollisions = true;

  const rightBarrier = leftBarrier.clone("barrierRight");
  rightBarrier.position.z *= -1;
  rightBarrier.checkCollisions = true;

  const endBarrierSpan = ROAD_WIDTH + SIDEWALK_WIDTH * 2 + barrierDepth * 2;
  const frontBarrier = BABYLON.MeshBuilder.CreateBox(
    "barrierFront",
    { width: barrierDepth, depth: endBarrierSpan, height: barrierHeight },
    scene
  );
  frontBarrier.position = new BABYLON.Vector3(ROAD_LENGTH * 0.5 + barrierDepth * 0.5, barrierHeight * 0.5, 0);
  frontBarrier.isVisible = false;
  frontBarrier.material = barrierMat;
  frontBarrier.checkCollisions = true;

  const backBarrier = frontBarrier.clone("barrierBack");
  backBarrier.position.x *= -1;
  backBarrier.checkCollisions = true;

  // Buildings and props.
  const buildingPositions = [-20, -10, 0, 10, 20];
  buildingPositions.forEach((x, index) => {
    const leftColor = new BABYLON.Color3(0.45 + index * 0.01, 0.42, 0.4);
    const rightColor = new BABYLON.Color3(0.38, 0.4 + index * 0.02, 0.42);
    createBuilding(scene, `buildingL${index}`, x, ROAD_WIDTH * 0.5 + 3.2, leftColor, 4 + Math.random() * 2.5);
    createBuilding(scene, `buildingR${index}`, x, -ROAD_WIDTH * 0.5 - 3.2, rightColor, 4 + Math.random() * 2.5);
  });

  createCar(scene, new BABYLON.Vector3(-8, 0.3, -1.6));
  createCar(scene, new BABYLON.Vector3(6, 0.3, 1.8), true);
  createFence(scene, new BABYLON.Vector3(-15, 0.5, ROAD_WIDTH * 0.5 + SIDEWALK_WIDTH + 0.1), ROAD_WIDTH + SIDEWALK_WIDTH * 2 + 1);
  createFence(scene, new BABYLON.Vector3(18, 0.5, -ROAD_WIDTH * 0.5 - SIDEWALK_WIDTH - 0.1), ROAD_WIDTH + SIDEWALK_WIDTH * 2 + 1);

  const lampSpacing = 16;
  for (let i = -ROAD_LENGTH * 0.5 + 5; i <= ROAD_LENGTH * 0.5 - 5; i += lampSpacing) {
    createLamp(scene, new BABYLON.Vector3(i, 0, ROAD_WIDTH * 0.5 + SIDEWALK_WIDTH * 0.3));
    createLamp(scene, new BABYLON.Vector3(i + lampSpacing * 0.5, 0, -ROAD_WIDTH * 0.5 - SIDEWALK_WIDTH * 0.3));
  }
}

function createAsphaltTexture(scene) {
  const size = 64;
  const texture = new BABYLON.DynamicTexture("asphaltTex", { width: size, height: size }, scene, false);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#3f3f3f";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#2f2f2f";
  for (let i = 0; i < 80; i++) {
    const x = Math.floor(Math.random() * size);
    const y = Math.floor(Math.random() * size);
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.fillStyle = "#8b7a3c";
  for (let y = 0; y < size; y += 12) {
    ctx.fillRect(size * 0.5 - 1, y, 2, 6);
  }
  texture.update(false);
  texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  texture.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
  return texture;
}

function createSidewalkTexture(scene) {
  const size = 64;
  const texture = new BABYLON.DynamicTexture("sidewalkTex", { width: size, height: size }, scene, false);
  const ctx = texture.getContext();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#555555";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#777777";
  ctx.lineWidth = 2;
  for (let i = 0; i <= size; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, size);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, size * 0.5);
  ctx.lineTo(size, size * 0.5);
  ctx.stroke();
  texture.update(false);
  texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  texture.uScale = 2;
  texture.vScale = 2;
  texture.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);
  return texture;
}

function createBuilding(scene, name, x, z, color, height) {
  const building = BABYLON.MeshBuilder.CreateBox(
    name,
    { width: 4.2, depth: 4.2, height: height },
    scene
  );
  building.position = new BABYLON.Vector3(x, height * 0.5, z);
  const mat = new BABYLON.StandardMaterial(`${name}-mat`, scene);
  mat.diffuseColor = color;
  mat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.02);
  mat.specularColor = BABYLON.Color3.Black();
  building.material = mat;
  building.checkCollisions = true;
}

function createCar(scene, position, flipped = false) {
  const body = BABYLON.MeshBuilder.CreateBox(
    `carBody${position.x}`,
    { width: 2.4, depth: 1.3, height: 0.7 },
    scene
  );
  body.position = position.clone();
  const roof = BABYLON.MeshBuilder.CreateBox(
    `carRoof${position.x}`,
    { width: 1.4, depth: 1.1, height: 0.4 },
    scene
  );
  roof.position = position.clone().add(new BABYLON.Vector3(0, 0.55, 0));
  const mat = new BABYLON.StandardMaterial("carMat", scene);
  mat.diffuseColor = flipped ? new BABYLON.Color3(0.35, 0.37, 0.4) : new BABYLON.Color3(0.36, 0.33, 0.3);
  mat.specularColor = BABYLON.Color3.Black();
  mat.emissiveColor = new BABYLON.Color3(0.03, 0.03, 0.03);
  body.material = mat;
  roof.material = mat;
  body.checkCollisions = true;
  roof.checkCollisions = true;
}

function createFence(scene, position, length) {
  const segment = BABYLON.MeshBuilder.CreateBox("fence", { width: length, depth: 0.1, height: 0.8 }, scene);
  segment.position = position;
  const mat = new BABYLON.StandardMaterial("fenceMat", scene);
  mat.diffuseColor = new BABYLON.Color3(0.32, 0.32, 0.32);
  mat.specularColor = BABYLON.Color3.Black();
  mat.emissiveColor = new BABYLON.Color3(0.02, 0.02, 0.02);
  segment.material = mat;
  segment.checkCollisions = true;
}

function createLamp(scene, position) {
  const pole = BABYLON.MeshBuilder.CreateCylinder("lampPole", { diameter: 0.08, height: 3.2 }, scene);
  pole.position = position.add(new BABYLON.Vector3(0, 1.6, 0));
  const head = BABYLON.MeshBuilder.CreateBox("lampHead", { width: 0.25, depth: 0.25, height: 0.35 }, scene);
  head.position = pole.position.add(new BABYLON.Vector3(0, 1.7, 0));
  head.rotation = new BABYLON.Vector3(0.4, 0, 0);

  const mat = new BABYLON.StandardMaterial("lampMat", scene);
  mat.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.4);
  mat.emissiveColor = new BABYLON.Color3(0.08, 0.08, 0.08);
  mat.specularColor = BABYLON.Color3.Black();
  pole.material = mat;

  const headMat = new BABYLON.StandardMaterial("lampHeadMat", scene);
  headMat.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.55);
  headMat.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.15);
  headMat.specularColor = BABYLON.Color3.Black();
  head.material = headMat;
}

function createEnemies(scene) {
  enemies.length = 0;
  const spacing = ROAD_LENGTH / (ENEMY_COUNT + 1);
  for (let i = 0; i < ENEMY_COUNT; i++) {
    const x = -ROAD_LENGTH * 0.5 + spacing * (i + 1) + (Math.random() - 0.5) * 2;
    const z = (Math.random() * 2 - 1) * (ROAD_WIDTH * 0.3);
    const mesh = BABYLON.MeshBuilder.CreateCapsule(
      `enemy${i}`,
      { height: 2.2, radius: 0.4, tessellation: 5 },
      scene
    );
    mesh.position = new BABYLON.Vector3(x, 1.1, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.checkCollisions = true;
    mesh.ellipsoid = new BABYLON.Vector3(0.45, 1.1, 0.45);
    mesh.ellipsoidOffset = new BABYLON.Vector3(0, 0, 0);
    mesh.isPickable = false;

    const mat = new BABYLON.StandardMaterial(`enemyMat${i}`, scene);
    mat.diffuseColor = new BABYLON.Color3(0.35 + Math.random() * 0.05, 0.32, 0.32);
    mat.emissiveColor = new BABYLON.Color3(0.03, 0.03, 0.03);
    mat.specularColor = BABYLON.Color3.Black();
    mesh.material = mat;

    enemies.push({
      mesh,
      speed: ENEMY_SPEED + Math.random() * 0.35,
      health: ENEMY_BASE_HEALTH,
      maxHealth: ENEMY_BASE_HEALTH,
      isAlive: true,
      attackCooldown: 0,
      idleDir: (Math.random() * 2 - 1) * ENEMY_IDLE_DRIFT,
      idleTimer: 0.6 + Math.random() * 1.5,
      spawnPosition: mesh.position.clone(),
    });
  }
}

function createHitEffectManager(scene) {
  const size = 64;
  const tex = new BABYLON.DynamicTexture("hitEffectTex", { width: size, height: size }, scene, false);
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 1;
  // Simple star burst
  ctx.fillRect(size / 2 - 1, 0, 2, size);
  ctx.fillRect(0, size / 2 - 1, size, 2);
  ctx.fillRect(size / 2 - 3, size / 2 - 3, 6, 6);
  tex.update(false);
  tex.updateSamplingMode(BABYLON.Texture.NEAREST_SAMPLINGMODE);

  const manager = new BABYLON.SpriteManager("hitEffects", "", 32, { width: size, height: size }, scene);
  manager.texture = tex;
  return manager;
}

function spawnHitEffect(position) {
  if (!hitEffectManager) return;
  const sprite = new BABYLON.Sprite("hit", hitEffectManager);
  sprite.position = position.clone().add(new BABYLON.Vector3(0, 1.0, 0));
  sprite.size = HIT_EFFECT_SIZE;
  sprite.color = new BABYLON.Color4(1, 1, 1, 1);
  sprite.angle = Math.random() * Math.PI * 2;
  hitEffects.push({ sprite, life: HIT_EFFECT_LIFETIME });
}

function updateHitEffects(delta) {
  for (let i = hitEffects.length - 1; i >= 0; i--) {
    const effect = hitEffects[i];
    effect.life -= delta;
    const t = Math.max(0, effect.life / HIT_EFFECT_LIFETIME);
    effect.sprite.color.a = t;
    effect.sprite.size = BABYLON.Scalar.Lerp(0.3, HIT_EFFECT_SIZE, t);
    if (effect.life <= 0) {
      effect.sprite.dispose();
      hitEffects.splice(i, 1);
    }
  }
}

function updateEnemies(scene, player, delta) {
  const targetClamp = ROAD_WIDTH * 0.45;
  const playerPos = player.position;

  enemies.forEach((enemy) => {
    if (!enemy.mesh || enemy.mesh.isDisposed()) return;
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);

    if (!enemy.isAlive) {
      enemy.mesh.position.y -= delta * DEATH_SINK_SPEED;
      if (enemy.mesh.position.y < -1.5) {
        enemy.mesh.isVisible = false;
      }
      return;
    }

    enemy.mesh.isVisible = true;
    const toPlayer = playerPos.subtract(enemy.mesh.position);
    const distance = toPlayer.length();

    if (distance < ENEMY_DETECTION_RADIUS) {
      const targetYaw = Math.atan2(toPlayer.x, toPlayer.z);
      const currentYaw = enemy.mesh.rotation.y;
      enemy.mesh.rotation.y = currentYaw + (targetYaw - currentYaw) * Math.min(1, delta * 6);

      const forward = new BABYLON.Vector3(Math.sin(enemy.mesh.rotation.y), 0, Math.cos(enemy.mesh.rotation.y));
      const step = forward.scale(enemy.speed * delta);
      enemy.mesh.moveWithCollisions(step);
    } else {
      enemy.idleTimer -= delta;
      if (enemy.idleTimer <= 0) {
        enemy.idleDir = (Math.random() * 2 - 1) * ENEMY_IDLE_DRIFT;
        enemy.idleTimer = 0.8 + Math.random() * 1.4;
      }
      enemy.mesh.position.z += enemy.idleDir * delta;
    }

    enemy.mesh.position.z = BABYLON.Scalar.Clamp(enemy.mesh.position.z, -targetClamp, targetClamp);

    if (distance < ENEMY_ATTACK_RANGE && enemy.attackCooldown <= 0 && playerState.isAlive) {
      applyDamageToPlayer(ENEMY_ATTACK_DAMAGE);
      enemy.attackCooldown = ENEMY_ATTACK_COOLDOWN;
    }
  });
}

function createPlayer(scene) {
  const player = BABYLON.MeshBuilder.CreateCapsule(
    "player",
    { height: 1.8, radius: 0.35, tessellation: 6 },
    scene
  );
  player.position = new BABYLON.Vector3(0, 0.9, 0);
  const mat = new BABYLON.StandardMaterial("playerMat", scene);
  mat.diffuseColor = new BABYLON.Color3(0.65, 0.65, 0.65);
  mat.emissiveColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  mat.specularColor = BABYLON.Color3.Black();
  player.material = mat;
  player.ellipsoid = new BABYLON.Vector3(0.4, 0.9, 0.4);
  player.ellipsoidOffset = new BABYLON.Vector3(0, 0, 0);
  player.checkCollisions = true;
  return player;
}

function handlePlayerAttack(player) {
  if (!playerState.isAlive || playerState.attackCooldown > 0) return;
  const weaponId = playerState.inventory[playerState.currentWeaponIndex];
  const weapon = WEAPONS[weaponId] || WEAPONS.bat;
  playerState.attackCooldown = weapon.cooldown;
  playerState.attackAnimTime = PLAYER_ATTACK_ANIM;

  const forwardDir = new BABYLON.Vector3(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y)).normalize();
  const hitThreshold = Math.cos(BABYLON.Tools.ToRadians(weapon.cone));
  const weaponRange = weapon.range;
  const weaponDamage = weapon.damage;

  if (weaponId === "pistol") {
    // Narrow cone, pick nearest in arc to simulate hitscan.
    let bestEnemy = null;
    let bestDist = Number.MAX_VALUE;
    enemies.forEach((enemy) => {
      if (!enemy.isAlive || !enemy.mesh || enemy.mesh.isDisposed()) return;
      const toEnemy = enemy.mesh.position.subtract(player.position);
      const distance = toEnemy.length();
      if (distance > weaponRange) return;
      const dir = toEnemy.normalize();
      const alignment = BABYLON.Vector3.Dot(forwardDir, dir);
      if (alignment < hitThreshold) return;
      if (distance < bestDist) {
        bestDist = distance;
        bestEnemy = enemy;
      }
    });
    if (bestEnemy) {
      bestEnemy.health -= weaponDamage;
      spawnHitEffect(bestEnemy.mesh.position);
      if (bestEnemy.health <= 0) {
        bestEnemy.health = 0;
        bestEnemy.isAlive = false;
      }
    }
    return;
  }

  enemies.forEach((enemy) => {
    if (!enemy.isAlive || !enemy.mesh || enemy.mesh.isDisposed()) return;
    const toEnemy = enemy.mesh.position.subtract(player.position);
    const distance = toEnemy.length();
    if (distance > weaponRange) return;
    const dir = toEnemy.normalize();
    const alignment = BABYLON.Vector3.Dot(forwardDir, dir);
    if (alignment < hitThreshold) return;

    enemy.health -= weaponDamage;
    spawnHitEffect(enemy.mesh.position);
    if (enemy.health <= 0) {
      enemy.health = 0;
      enemy.isAlive = false;
    }
  });
}

function resetGame(scene, player, cameraRig) {
  player.position.copyFromFloats(0, 0.9, 0);
  player.rotation.y = 0;
  playerState.health = playerState.maxHealth;
  playerState.isAlive = true;
  playerState.attackCooldown = 0;
  playerState.attackAnimTime = 0;
  respawnEnemies();
  cameraRig.smoothedPosition = player.position.clone().add(new BABYLON.Vector3(0, CAMERA_HEIGHT, -CAMERA_DISTANCE));
  cameraRig.target = player.position.clone();
  cameraRig.yaw = 0;
  cameraRig.pitch = -0.12;
  cameraRig.bobPhase = 0;
  updateHUD();
}

function respawnEnemies() {
  enemies.forEach((enemy) => {
    if (!enemy.mesh || enemy.mesh.isDisposed()) return;
    enemy.health = enemy.maxHealth;
    enemy.isAlive = true;
    enemy.attackCooldown = 0;
    enemy.mesh.isVisible = true;
    enemy.mesh.position.copyFrom(enemy.spawnPosition);
    enemy.mesh.rotation.y = Math.random() * Math.PI * 2;
  });
}

function applyDamageToPlayer(amount) {
  if (!playerState.isAlive) return;
  playerState.health = Math.max(0, playerState.health - amount);
  if (playerState.health <= 0) {
    playerState.isAlive = false;
  }
}

function setupCamera(scene, player) {
  const camera = new BABYLON.FreeCamera("followCam", new BABYLON.Vector3(0, CAMERA_HEIGHT, -CAMERA_DISTANCE), scene);
  camera.inputs.clear(); // manual controls only
  camera.minZ = 0.1;
  camera.maxZ = 200;
  camera.fov = 0.9;

  return {
    camera,
    yaw: 0,
    pitch: -0.12,
    smoothedPosition: player.position.clone().add(new BABYLON.Vector3(0, CAMERA_HEIGHT, -CAMERA_DISTANCE)),
    target: player.position.clone(),
    bobPhase: 0,
  };
}

function setupInput(scene, player, cameraRig) {
  const state = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    run: false,
    pointerLocked: false,
    attackPressed: false,
    restartPressed: false,
    switchTo: null,
  };

  const keyMap = {
    KeyW: "forward",
    KeyS: "backward",
    KeyA: "left",
    KeyD: "right",
    ArrowUp: "forward",
    ArrowDown: "backward",
    ArrowLeft: "left",
    ArrowRight: "right",
    ShiftLeft: "run",
    ShiftRight: "run",
  };

  window.addEventListener("keydown", (event) => {
    const key = keyMap[event.code];
    if (key) {
      state[key] = true;
      event.preventDefault();
    }
    if (event.code === "Space" && !event.repeat) {
      state.attackPressed = true;
      event.preventDefault();
    }
    if (event.code === "KeyR" && !event.repeat) {
      state.restartPressed = true;
      event.preventDefault();
    }
    if ((event.code === "Digit1" || event.code === "Numpad1") && !event.repeat) {
      state.switchTo = 0;
      event.preventDefault();
    }
    if ((event.code === "Digit2" || event.code === "Numpad2") && !event.repeat) {
      state.switchTo = 1;
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => {
    const key = keyMap[event.code];
    if (key) {
      state[key] = false;
      event.preventDefault();
    }
  });

  const canvasTarget = scene.getEngine().getRenderingCanvas();
  if (canvasTarget) {
    canvasTarget.addEventListener("click", () => {
      canvasTarget.requestPointerLock?.();
    });
  }

  const lockChange = () => {
    state.pointerLocked = document.pointerLockElement === canvasTarget;
  };
  document.addEventListener("pointerlockchange", lockChange);

  window.addEventListener("mousemove", (event) => {
    if (!state.pointerLocked) return;
    cameraRig.yaw += event.movementX * CAMERA_SENSITIVITY;
    cameraRig.pitch += event.movementY * CAMERA_SENSITIVITY;
    cameraRig.pitch = BABYLON.Scalar.Clamp(cameraRig.pitch, -CAMERA_PITCH_LIMIT, CAMERA_PITCH_LIMIT);
  });

  return state;
}

function setupAmbientAudio() {
  let started = false;
  let audioContext;

  const startNoise = () => {
    if (started) return;
    started = true;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const duration = 2;
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.02;
    }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = audioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 320;

    const gain = audioContext.createGain();
    gain.gain.value = 0.25;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    source.start(0);
  };

  ["pointerdown", "keydown"].forEach((eventName) => {
    window.addEventListener(eventName, () => {
      startNoise();
      audioContext?.resume?.();
    });
  });
}

function update(scene, player, cameraRig, inputState, delta) {
  playerState.attackCooldown = Math.max(0, playerState.attackCooldown - delta);
  playerState.attackAnimTime = Math.max(0, playerState.attackAnimTime - delta);

  if (inputState.restartPressed && !playerState.isAlive) {
    resetGame(scene, player, cameraRig);
  }

  if (inputState.switchTo !== null) {
    if (inputState.switchTo >= 0 && inputState.switchTo < playerState.inventory.length) {
      playerState.currentWeaponIndex = inputState.switchTo;
      updateHUD();
    }
    inputState.switchTo = null;
  }

  if (!playerState.isAlive) {
    updateCameraRig(cameraRig, player, delta, false);
    updateHitEffects(delta);
    updateHUD();
    inputState.attackPressed = false;
    inputState.restartPressed = false;
    return;
  }

  const forward = (inputState.forward ? 1 : 0) + (inputState.backward ? -1 : 0);
  const turn = (inputState.right ? 1 : 0) + (inputState.left ? -1 : 0);

  if (turn !== 0) {
    player.rotation.y += turn * ROTATION_SPEED * delta;
  }

  const forwardDir = new BABYLON.Vector3(Math.sin(player.rotation.y), 0, Math.cos(player.rotation.y));
  const speed = WALK_SPEED * (inputState.run ? RUN_MULTIPLIER : 1);
  const move = forwardDir.scale(forward * speed * delta);

  if (forward !== 0) {
    player.moveWithCollisions(move);
  }

  // Gravity keeps the capsule grounded and prevents clipping through raised props.
  player.moveWithCollisions(scene.gravity.scale(delta));

  const isMoving = forward !== 0;

  if (inputState.attackPressed) {
    handlePlayerAttack(player);
  }

  updateEnemies(scene, player, delta);
  updateHitEffects(delta);
  updateCameraRig(cameraRig, player, delta, isMoving);
  updateHUD();

  inputState.attackPressed = false;
  inputState.restartPressed = false;
}

function updateCameraRig(cameraRig, player, delta, isMoving) {
  const { camera } = cameraRig;
  const lerp = 1 - Math.pow(1 - CAMERA_LERP, delta * 60);
  const attackIntensity = playerState.attackAnimTime > 0
    ? Math.sin((playerState.attackAnimTime / PLAYER_ATTACK_ANIM) * Math.PI)
    : 0;

  if (isMoving) {
    cameraRig.bobPhase += delta * BOB_SPEED;
  } else {
    cameraRig.bobPhase = BABYLON.Scalar.Lerp(cameraRig.bobPhase, 0, delta * 4);
  }
  const bobOffset = isMoving ? Math.sin(cameraRig.bobPhase) * BOB_AMOUNT : 0;

  const yaw = player.rotation.y + cameraRig.yaw;
  const pitch = cameraRig.pitch - attackIntensity * 0.08;
  const offsetDir = new BABYLON.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch)
  );

  const attackPush = attackIntensity * 0.6;
  const cameraDistance = Math.max(2.5, CAMERA_DISTANCE - attackPush);
  const desiredPos = player.position
    .add(new BABYLON.Vector3(0, CAMERA_HEIGHT + bobOffset, 0))
    .subtract(offsetDir.scale(cameraDistance));

  if (!cameraRig.smoothedPosition) {
    cameraRig.smoothedPosition = desiredPos.clone();
  }

  cameraRig.smoothedPosition = BABYLON.Vector3.Lerp(cameraRig.smoothedPosition, desiredPos, lerp);

  const jitter = new BABYLON.Vector3(
    (Math.random() * 2 - 1) * CAMERA_JITTER,
    (Math.random() * 2 - 1) * CAMERA_JITTER,
    (Math.random() * 2 - 1) * CAMERA_JITTER
  );

  const cameraPos = cameraRig.smoothedPosition.add(jitter);
  camera.position.copyFrom(cameraPos);

  const target = player.position.add(new BABYLON.Vector3(0, CAMERA_TARGET_HEIGHT + bobOffset * 0.5, 0));
  cameraRig.target = BABYLON.Vector3.Lerp(cameraRig.target, target, lerp);
  camera.setTarget(cameraRig.target);
}

function createHUD() {
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed",
    top: "12px",
    right: "12px",
    padding: "8px 10px",
    background: "rgba(20, 20, 20, 0.5)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    borderRadius: "4px",
    fontSize: "12px",
    lineHeight: "1.5",
    color: "#e5e5e5",
    fontFamily: '"Courier New", monospace',
    pointerEvents: "none",
  });

  const hp = document.createElement("div");
  hp.textContent = `HP: ${playerState.health} / ${playerState.maxHealth}`;

  const weapon = document.createElement("div");
  weapon.textContent = `Weapon: ${WEAPONS[playerState.inventory[playerState.currentWeaponIndex]].name}`;

  const controls = document.createElement("div");
  controls.innerHTML = "Space: attack<br>1/2: switch weapon<br>R: restart when dead";

  container.appendChild(hp);
  container.appendChild(weapon);
  container.appendChild(controls);
  document.body.appendChild(container);

  const deathMessage = document.createElement("div");
  deathMessage.textContent = "You died. Press R to restart.";
  Object.assign(deathMessage.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    fontSize: "24px",
    fontFamily: '"Courier New", monospace',
    color: "#ff9b9b",
    padding: "12px 16px",
    background: "rgba(0, 0, 0, 0.6)",
    border: "1px solid rgba(255, 255, 255, 0.3)",
    borderRadius: "4px",
    pointerEvents: "none",
    display: "none",
  });
  document.body.appendChild(deathMessage);

  return { container, hp, weapon, controls, deathMessage };
}

function updateHUD() {
  if (!hudElements) return;
  const hpValue = Math.max(0, Math.round(playerState.health));
  hudElements.hp.textContent = `HP: ${hpValue} / ${playerState.maxHealth}`;
  hudElements.hp.style.color = playerState.health <= playerState.maxHealth * 0.3 ? "#ff6b6b" : "#e5e5e5";
  hudElements.deathMessage.style.display = playerState.isAlive ? "none" : "block";
  const weaponId = playerState.inventory[playerState.currentWeaponIndex];
  hudElements.weapon.textContent = `Weapon: ${WEAPONS[weaponId].name}`;
}
