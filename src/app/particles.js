import robotoGrid from './textures/roboto_grid.png';
import physicsVS from './shaders/physics_v';
import physicsFS from './shaders/physics_f';
import renderVS from './shaders/render_v';
import renderFS from './shaders/render_f';
import debugVS from './shaders/debug_v';
import debugFS from './shaders/debug_f';
import copyVS from './shaders/copy_v';
import copyFS from './shaders/copy_f';

const PARTICLE_COUNT = Math.pow(256, 2);
const PARTICLE_COUNT_SQRT = Math.sqrt(PARTICLE_COUNT);
const PARTICLE_DATA_SLOTS = 1;
const PARTICLE_DATA_WIDTH = PARTICLE_COUNT_SQRT * PARTICLE_DATA_SLOTS;
const PARTICLE_DATA_HEIGHT = PARTICLE_COUNT_SQRT;
const PARTICLE_EMIT_RATE = 10;

let physicsInputTexture;
let physicsOutputTexture;
let dataLocationBuffer;
let viewportQuadBuffer;
let particleTexture;
let physicsProgram;
let renderProgram;
let debugProgram;
let copyProgram;
let frameBuffer;
let container;
let emitIndex;
let lastEmit;
let millis;
let height;
let width;
let scale;
let clock;
let gl;

const createContext = (el) => {
  console.log(el);
  const gl = el.getContext('webgl') || el.getContext('experimental-webgl');
  if (!gl) {
    throw 'WebGL not supported';
  }
  if (!gl.getExtension('OES_texture_float')) {
    throw 'Float textures not supported';
  }
  return gl;
};

const createShader = (source, type) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw gl.getShaderInfoLog(shader);
  }
  return shader;
};

const createProgram = (vSource, fSource) => {
  const vs = createShader(vSource, gl.VERTEX_SHADER);
  const fs = createShader(fSource, gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw gl.getProgramInfoLog(program);
  }
  return program;
};

const createImageTexture = (image) => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const update = () => {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
  };
  image.naturalWidth > 0 ? update() : image.onload = update;
  return texture;
};

const createDataTexture = (width, height, data) => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.FLOAT, data);
  return texture;
};

const createFramebuffer = () => {
  const buffer = gl.createFramebuffer();
  return buffer;
};

const random = (min, max) => {
  if (typeof min !== 'number') min = 1;
  if (typeof max !== 'number') max = min; min = 0;
  return min + Math.random() * (max - min);
};

const createPhysicsProgram = () => {
  const program = createProgram(physicsVS, physicsFS);
  program.vertexPosition = gl.getAttribLocation(program, 'vertexPosition');
  program.physicsData = gl.getUniformLocation(program, 'physicsData');
  program.bounds = gl.getUniformLocation(program, 'bounds');
  gl.enableVertexAttribArray(program.vertexPosition);
  return program;
};

const createRenderProgram = () => {
  const program = createProgram(renderVS, renderFS);
  program.dataLocation = gl.getAttribLocation(program, 'dataLocation');
  program.particleTexture = gl.getUniformLocation(program, 'particleTexture');
  program.physicsData = gl.getUniformLocation(program, 'physicsData');
  program.destSize = gl.getUniformLocation(program, 'destSize');
  program.time = gl.getUniformLocation(program, 'time');
  gl.enableVertexAttribArray(program.dataLocation);
  return program;
};

const createDebugProgram = () => {
  const program = createProgram(debugVS, debugFS);
  program.vertexPosition = gl.getAttribLocation(program, 'vertexPosition');
  program.texture = gl.getUniformLocation(program, 'texture');
  gl.enableVertexAttribArray(program.vertexPosition);
  return program;
};

const createCopyProgram = () => {
  const program = createProgram(copyVS, copyFS);
  program.vertexPosition = gl.getAttribLocation(program, 'vertexPosition');
  program.texture = gl.getUniformLocation(program, 'texture');
  gl.enableVertexAttribArray(program.vertexPosition);
  return program;
};

const createPhysicsDataTexture = () => {
  const size = 4 * PARTICLE_COUNT * PARTICLE_DATA_SLOTS;
  const data = new Float32Array(size);
  return createDataTexture(PARTICLE_DATA_WIDTH, PARTICLE_DATA_HEIGHT, data);
};

const createParticleTexture = () => {
  const image = new Image();
  image.src = robotoGrid;
  return createImageTexture(image);
};

const createDataLocationBuffer = () => {
  const data = new Float32Array(PARTICLE_COUNT * 2);
  const step = 1 / PARTICLE_COUNT_SQRT;
  for (let u, v, i = 0; i < PARTICLE_COUNT; i++) {
    u = i * 2;
    v = u + 1;
    data[u] = step * Math.floor(i % PARTICLE_COUNT_SQRT);
    data[v] = step * Math.floor(i / PARTICLE_COUNT_SQRT);
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
};

const createViewportQuadBuffer = () => {
  const data = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
};

const emitParticles = (count, radius, size, chars, phiOffset=0) => {
  gl.bindTexture(gl.TEXTURE_2D, physicsInputTexture);
  const x = Math.floor((emitIndex * PARTICLE_DATA_SLOTS) % PARTICLE_DATA_WIDTH);
  const y = Math.floor(emitIndex / PARTICLE_DATA_HEIGHT);
  const chunks = [[x, y, count * PARTICLE_DATA_SLOTS]];
  const split = (chunk) => {
    const boundary = chunk[0] + chunk[2];
    if (boundary > PARTICLE_DATA_WIDTH) {
      const delta = boundary - PARTICLE_DATA_WIDTH;
      chunk[2] -= delta;
      chunk = [0, (chunk[1] + 1) % PARTICLE_DATA_HEIGHT, delta];
      chunks.push(chunk);
      split(chunk);
    }
  };
  split(chunks[0]);
  let i, j, n, m, chunk, data, index = 0;
  for (i = 0, n = chunks.length; i < n; i++) {
    chunk = chunks[i];
    data = [];
    for (j = 0, m = chunk[2]; j < m; j++) {
      data.push(
        (2*Math.PI / count) * index + phiOffset,
        radius,
        size,
        chars[index % chars.length]
      );
      index++;
    }
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, chunk[0], chunk[1], chunk[2], 1,
      gl.RGBA, gl.FLOAT, new Float32Array(data)
    );
  }
  emitIndex += count;
  emitIndex %= PARTICLE_COUNT;
};


// ——————————————————————————————————————————————————
// Main
// ——————————————————————————————————————————————————

export const init = (el) => {
  gl = createContext(el);
  container = el;
  emitIndex = 0;
  millis = 0;
  clock = Date.now();
  // document.addEventListener('touchmove', touch);
  // document.addEventListener('mousemove', touch);
  window.addEventListener('resize', resize);
  setup();
  resize();
  initParticles("JEZE   ", 0, 0.4);
  update();
};

const toLetterIndices = (text) => {
  return text.split('').reverse().map(c => c.codePointAt(0) - 65)
}

const initParticles = (text, deltaC, deltaPhi) => {
  for(let i = 17; i < 100; i++) {
    emitParticles(100 + i * deltaC, ((20 + (3 * i) + (0.5*0.5*i*i)) / window.innerWidth) / 2, (3 + (i/2)) / 2, toLetterIndices(text), i*deltaPhi);
  }
};

const cleanParticleData = () => {
  const a = []
  for(let i = 0; i < PARTICLE_DATA_WIDTH * PARTICLE_DATA_HEIGHT* 4; i++) {
    a.push([0.0,0.0,0.0,0.0])
  }
  gl.bindTexture(gl.TEXTURE_2D, physicsInputTexture);
  gl.texSubImage2D(
    gl.TEXTURE_2D, 0, 0, 0, PARTICLE_DATA_WIDTH, PARTICLE_DATA_WIDTH,
    gl.RGBA, gl.FLOAT, new Float32Array(a)
  );
}

export const resetSpiral = (text, deltaC, deltaPhi) => {
  //cleanParticleData();
  emitIndex = 0;
  initParticles(text, deltaC, deltaPhi);
}

const setup = () => {
  physicsInputTexture = createPhysicsDataTexture();
  physicsOutputTexture = createPhysicsDataTexture();
  dataLocationBuffer = createDataLocationBuffer();
  viewportQuadBuffer = createViewportQuadBuffer();
  particleTexture = createParticleTexture();
  physicsProgram = createPhysicsProgram();
  renderProgram = createRenderProgram();
  debugProgram = createDebugProgram();
  copyProgram = createCopyProgram();
  frameBuffer = createFramebuffer();
};

const physics = () => {
  gl.useProgram(physicsProgram);
  gl.viewport(0, 0, PARTICLE_DATA_WIDTH, PARTICLE_DATA_HEIGHT);
  gl.bindBuffer(gl.ARRAY_BUFFER, viewportQuadBuffer);
  gl.vertexAttribPointer(physicsProgram.vertexPosition, 2, gl.FLOAT, gl.FALSE, 0, 0);
  gl.uniform2f(physicsProgram.bounds, PARTICLE_DATA_WIDTH, PARTICLE_DATA_HEIGHT);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, physicsInputTexture);
  gl.uniform1i(physicsProgram.physicsData, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, physicsOutputTexture, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};

const copy = () => {
  gl.useProgram(copyProgram);
  gl.viewport(0, 0, PARTICLE_DATA_WIDTH, PARTICLE_DATA_HEIGHT);
  gl.bindBuffer(gl.ARRAY_BUFFER, viewportQuadBuffer);
  gl.vertexAttribPointer(copyProgram.vertexPosition, 2, gl.FLOAT, gl.FALSE, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, physicsOutputTexture);
  gl.uniform1i(copyProgram.physicsData, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, physicsInputTexture, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};

const debug = () => {
  const x = 16 * scale;
  const y = 16 * scale;
  const w = 360 * scale;
  const h = 180 * scale;
  gl.useProgram(debugProgram);
  gl.viewport(x, y, w, h);
  gl.bindBuffer(gl.ARRAY_BUFFER, viewportQuadBuffer);
  gl.vertexAttribPointer(physicsProgram.vertexPosition, 2, gl.FLOAT, gl.FALSE, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, physicsOutputTexture);
  gl.uniform1i(debugProgram.texture, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disable(gl.BLEND);
};

const render = () => {
  gl.useProgram(renderProgram);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.bindBuffer(gl.ARRAY_BUFFER, dataLocationBuffer);
  gl.vertexAttribPointer(renderProgram.dataLocation, 2, gl.FLOAT, gl.FALSE, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, physicsOutputTexture);
  gl.uniform1i(renderProgram.physicsData, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, particleTexture);
  gl.uniform1i(renderProgram.particleTexture, 1);
  gl.uniform2f(renderProgram.destSize, window.innerWidth, window.innerHeight);
  gl.uniform1f(renderProgram.time, millis);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
  gl.disable(gl.BLEND);
};

let loggedAt = 0;

const tick = () => {
  const now = Date.now();
  const delta = now - clock;
  if((now - loggedAt) > 1000) {
    console.log("FPS: " + 1000.0/delta);
    loggedAt = now;
  }
  millis += now - clock || 0;
  clock = now;
};

const spawn = () => {
  // if (millis < 3000) {
  //   emitParticles(800, [
  //     -1.0 + Math.sin(millis * 0.001) * 2.0,
  //     -0.2 + Math.cos(millis * 0.004) * 0.5,
  //     Math.sin(millis * 0.015) * -0.05
  //   ]);
  // }
};

const touch = (event) => {
  if (millis - lastEmit < 20) return;
  const touches = event.changedTouches || [event];
  const limit = PARTICLE_EMIT_RATE / touches.length;
  for (let i = 0; i < touches.length; i++) {
    const touch = touches[i];
    const x = (touch.clientX / width) * 2 - 1;
    const y = (touch.clientY / height) * -2 + 1;
    emitParticles(limit, [x, y, 0]);
  }
  lastEmit = millis;
};

const resize = () => {
  scale = window.devicePixelRatio || 1;
  width = window.innerWidth;
  height = window.innerHeight;
  gl.canvas.width = width * scale;
  gl.canvas.height = height * scale;
  gl.canvas.style.width = width + 'px';
  gl.canvas.style.height = height + 'px';
};

const update = () => {
  requestAnimationFrame(update);
  tick();
  spawn();
  physics();
  copy();
  render();
  debug();
};

