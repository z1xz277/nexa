(() => {
  let canvas = document.getElementById('background');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    progress: 0,
    targetMouse: { x: 0, y: 0 },
    mouse: { x: 0, y: 0 },
    frame: 0,
    lastFrame: 0,
    running: false,
    destroyed: false,
    mode: 'none'
  };

  const vertexSource = `
    attribute vec2 aPosition;
    void main() {
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    #extension GL_OES_standard_derivatives : enable
    precision highp float;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uProgress;
    uniform vec2 uMouse;

    vec2 mod289(vec2 x) {
      return x - floor(x * (1.0 / 289.0)) * 289.0;
    }

    vec3 mod289(vec3 x) {
      return x - floor(x * (1.0 / 289.0)) * 289.0;
    }

    vec4 mod289(vec4 x) {
      return x - floor(x * (1.0 / 289.0)) * 289.0;
    }

    vec4 permute(vec4 x) {
      return mod289(((x * 34.0) + 1.0) * x);
    }

    vec4 taylorInvSqrt(vec4 r) {
      return 1.79284291400159 - 0.85373472095314 * r;
    }

    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
      vec2 i = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = x0.x > x0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289(i);
      vec3 p = mod289(i.y + vec3(0.0, i1.y, 1.0));
      vec3 x = x0.x + vec3(0.0, i1.x, 1.0);
      vec3 y = x0.y + vec3(0.0, i1.y, 1.0);
      vec3 h = 0.5 - vec3(dot(x, x), dot(p, p), dot(x12.xy, x12.xy)) + vec3(dot(x, p), dot(x12.xz, p.yz), dot(x12.yz, p));
      vec3 n = h * h * h * h * vec3(dot(x, h.yzx), dot(p, h.zxy), dot(x12.xy, h.yzx));
      return 42.0 * dot(n, vec3(1.0));
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      mat2 rotation = mat2(0.80, 0.60, -0.60, 0.80);
      for (int i = 0; i < 4; i++) {
        value += amplitude * snoise(p);
        p = rotation * p * 2.03 + 13.1;
        amplitude *= 0.5;
      }
      return value;
    }

    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
      float time = uTime * mix(0.012, 0.034, uProgress);
      vec2 mouseOffset = uMouse * vec2(0.022, -0.018);
      vec2 q = vec2(
        fbm(p * 1.35 + vec2(time, -time * 0.7) + mouseOffset),
        fbm(p * 1.35 + vec2(5.2, 1.3) - time * 0.55)
      );
      vec2 warped = p * 2.15 + q * 1.45 + mouseOffset * 0.6;
      float field = fbm(warped + vec2(time * 0.35, -time * 0.22));
      float density = mix(18.0, 27.0, uProgress);
      float level = field * density;
      float distanceToLine = abs(fract(level) - 0.5);
      float width = max(0.0025, fwidth(level) * 0.72);
      float line = 1.0 - smoothstep(width, width * 2.1, distanceToLine);
      float lineOpacity = mix(0.08, 0.14, uProgress);
      vec3 color = vec3(1.0) - vec3(line * lineOpacity);

      float grain = hash(gl_FragCoord.xy + floor(uTime * 8.0)) - 0.5;
      color += grain * 0.008;

      float leftText = exp(-18.0 * pow(p.x + 0.43, 2.0));
      float rightText = exp(-14.0 * pow(p.x - 0.36, 2.0));
      float verticalFade = 1.0 - smoothstep(0.12, 0.62, abs(p.y));
      float textMask = max(leftText, rightText) * verticalFade;
      color = mix(color, vec3(1.0), textMask * 0.94);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error('Shader compilation failed.');
    }
    return shader;
  }

  function createProgram(gl) {
    const program = gl.createProgram();
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader linking failed.');
    return program;
  }

  function startWebGL() {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl || !gl.getExtension('OES_standard_derivatives')) throw new Error('WebGL is unavailable.');
    const program = createProgram(gl);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);

    const uniforms = {
      resolution: gl.getUniformLocation(program, 'uResolution'),
      time: gl.getUniformLocation(program, 'uTime'),
      progress: gl.getUniformLocation(program, 'uProgress'),
      mouse: gl.getUniformLocation(program, 'uMouse')
    };

    state.mode = 'webgl';
    state.render = (time) => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, time);
      gl.uniform1f(uniforms.progress, state.progress);
      gl.uniform2f(uniforms.mouse, state.mouse.x, state.mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    state.destroyRenderer = () => {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }

  function startFallback() {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    state.mode = '2d';
    state.render = (time) => {
      const width = canvas.width / 0.6;
      const height = canvas.height / 0.6;
      context.setTransform(0.6, 0, 0, 0.6, 0, 0);
      context.fillStyle = '#FFF';
      context.fillRect(0, 0, width, height);
      const rows = Math.round(18 + state.progress * 9);
      const spacing = height / rows;
      const speed = 0.012 + state.progress * 0.034;
      context.lineWidth = 1;
      context.strokeStyle = `rgba(0, 0, 0, ${0.08 + state.progress * 0.06})`;
      for (let row = -2; row < rows + 2; row += 1) {
        context.beginPath();
        for (let x = -16; x <= width + 16; x += 8) {
          const phase = x * 0.012 + row * 0.82 + time * speed;
          const y = row * spacing
            + Math.sin(phase) * 16
            + Math.sin(phase * 0.47 + row * 0.31) * 22
            + Math.cos(x * 0.005 - time * speed * 0.6) * 12;
          if (x === -16) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
      context.fillStyle = 'rgba(0, 0, 0, 0.025)';
      for (let index = 0; index < 500; index += 1) {
        const x = (index * 73.13) % width;
        const y = (index * 151.71) % height;
        context.fillRect(Math.floor(x), Math.floor(y), 1, 1);
      }
    };
    state.destroyRenderer = () => {};
  }

  function resize() {
    const ratio = 0.6;
    const width = Math.max(1, Math.round(window.innerWidth * ratio));
    const height = Math.max(1, Math.round(window.innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (reducedMotion.matches) state.render?.(0);
  }

  function frame(now) {
    if (!state.running || state.destroyed) return;
    state.frame = requestAnimationFrame(frame);
    if (document.hidden || now - state.lastFrame < 1000 / 60) return;
    const elapsed = state.lastFrame ? (now - state.lastFrame) / 1000 : 0;
    state.lastFrame = now;
    const ease = 1 - Math.exp(-elapsed * 2.2);
    state.mouse.x += (state.targetMouse.x - state.mouse.x) * ease;
    state.mouse.y += (state.targetMouse.y - state.mouse.y) * ease;
    state.render(now / 1000);
  }

  function syncMotion() {
    cancelAnimationFrame(state.frame);
    state.lastFrame = 0;
    if (reducedMotion.matches || document.hidden) {
      state.running = false;
      state.render?.(0);
    } else {
      state.running = true;
      state.frame = requestAnimationFrame(frame);
    }
  }

  function onPointerMove(event) {
    state.targetMouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    state.targetMouse.y = (event.clientY / window.innerHeight) * 2 - 1;
  }

  try {
    startWebGL();
  } catch {
    const replacement = canvas.cloneNode(false);
    canvas.replaceWith(replacement);
    canvas = replacement;
    canvas.width = Math.max(1, Math.round(window.innerWidth * 0.6));
    canvas.height = Math.max(1, Math.round(window.innerHeight * 0.6));
    startFallback();
  }

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', syncMotion);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  reducedMotion.addEventListener?.('change', syncMotion);
  syncMotion();

  window.NexaBackground = {
    setProgress(value) {
      state.progress = Math.max(0, Math.min(1, value));
      if (reducedMotion.matches) state.render?.(0);
    },
    destroy() {
      state.destroyed = true;
      state.running = false;
      cancelAnimationFrame(state.frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', syncMotion);
      window.removeEventListener('pointermove', onPointerMove);
      reducedMotion.removeEventListener?.('change', syncMotion);
      state.destroyRenderer?.();
    }
  };
})();
