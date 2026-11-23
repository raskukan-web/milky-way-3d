'use strict';
/* =====================================================================
 *  Обёртка над WebGL2: шейдерные программы с авто-uniform, буферы,
 *  инстансинг, HDR-рендер-таргеты.
 * ===================================================================== */
(function () {
  const MW = window.MW;

  /* Программа компилируется «в фоне»: конструктор только запускает компиляцию и линковку,
     а статус проверяется в finish(). Пока статус не запрошен, ANGLE (KHR_parallel_shader_compile)
     компилирует все шейдеры параллельно в нескольких потоках. */
  class Program {
    constructor(gl, name, vsSrc, fsSrc) {
      this.gl = gl; this.name = name;
      this.src = [vsSrc, fsSrc];
      const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      this.vs = mk(gl.VERTEX_SHADER, vsSrc);
      this.fs = mk(gl.FRAGMENT_SHADER, fsSrc);
      const p = gl.createProgram();
      gl.attachShader(p, this.vs); gl.attachShader(p, this.fs);
      gl.linkProgram(p);
      this.prog = p;
      this.ready = false;
    }
    done(ext) { return this.ready || !ext || this.gl.getProgramParameter(this.prog, ext.COMPLETION_STATUS_KHR); }
    finish() {
      if (this.ready) return this;
      const gl = this.gl, p = this.prog, name = this.name;
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        Program.check(gl, this.vs, this.src[0], name + '.vs');
        Program.check(gl, this.fs, this.src[1], name + '.fs');
        throw new Error('Link error [' + name + ']: ' + gl.getProgramInfoLog(p));
      }
      gl.deleteShader(this.vs); gl.deleteShader(this.fs);
      this.ready = true;
      this.uniforms = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      let texUnit = 0;
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i);
        const uname = info.name.replace(/\[0\]$/, '');
        const u = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
        if (info.type === gl.SAMPLER_2D || info.type === gl.SAMPLER_3D) u.unit = texUnit++;
        this.uniforms[uname] = u;
      }
      return this;
    }
    static check(gl, s, src, name) {
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        const lines = src.split('\n');
        let ctx = '';
        const m = /ERROR: \d+:(\d+)/.exec(log);
        if (m) { const ln = +m[1]; for (let i = Math.max(1, ln - 3); i <= Math.min(lines.length, ln + 2); i++) ctx += (i === ln ? '>> ' : '   ') + i + ': ' + lines[i - 1] + '\n'; }
        throw new Error('Shader compile error [' + name + ']:\n' + log + '\n' + ctx);
      }
      return s;
    }
    use() { if (!this.ready) this.finish(); this.gl.useProgram(this.prog); return this; }
    set(name, v) {
      if (!this.ready) this.finish();
      const u = this.uniforms[name];
      if (!u) return this;
      const gl = this.gl;
      switch (u.type) {
        case gl.FLOAT: u.size > 1 ? gl.uniform1fv(u.loc, v) : gl.uniform1f(u.loc, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
        case gl.INT: case gl.BOOL: u.size > 1 ? gl.uniform1iv(u.loc, v) : gl.uniform1i(u.loc, v); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
        case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
        default: gl.uniform1f(u.loc, v);
      }
      return this;
    }
    tex(name, texture, target) {
      if (!this.ready) this.finish();
      const u = this.uniforms[name];
      if (!u) return this;
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + u.unit);
      gl.bindTexture(target || gl.TEXTURE_2D, texture);
      gl.uniform1i(u.loc, u.unit);
      return this;
    }
    setAll(obj) { for (const k in obj) this.set(k, obj[k]); return this; }
  }

  class GLContext {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', {
        antialias: false, alpha: false, depth: false, stencil: false,
        powerPreference: 'high-performance', premultipliedAlpha: false, preserveDrawingBuffer: false,
      });
      if (!gl) throw new Error('WebGL2 недоступен. Используйте свежий Chrome / Edge / Firefox с включённым аппаратным ускорением.');
      this.gl = gl;
      this.canvas = canvas;
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Нет расширения EXT_color_buffer_float (HDR-рендер недоступен).');
      gl.getExtension('OES_texture_float_linear');
      this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

      // общий единичный квад (TRIANGLE_STRIP), атрибут location=0
      this.quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      this.emptyVAO = gl.createVertexArray();
    }
    program(name, vs, fs) { const p = new Program(this.gl, name, vs, fs); (this.programs || (this.programs = [])).push(p); return p; }
    // асинхронно дождаться компиляции всех программ (интерфейс загрузки не замирает)
    async waitPrograms(onProgress) {
      const ext = this.gl.getExtension('KHR_parallel_shader_compile');
      const list = this.programs || [];
      if (ext) {
        const t0 = performance.now();
        for (;;) {
          const left = list.filter((p) => !p.done(ext)).length;
          if (onProgress) onProgress(list.length - left, list.length);
          if (!left || performance.now() - t0 > 180000) break;
          await new Promise((r) => setTimeout(r, 60));
        }
      }
      for (const p of list) p.finish();
    }

    buffer(data, usage) {
      const gl = this.gl;
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
      return b;
    }
    updateBuffer(buf, data) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    }
    /* attrs: [{buf, loc, size, stride(bytes), offset(bytes), divisor}] ; quad=true добавляет loc0 = углы квада */
    vao(attrs, quad) {
      const gl = this.gl;
      const v = gl.createVertexArray();
      gl.bindVertexArray(v);
      if (quad) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      }
      for (const a of attrs) {
        gl.bindBuffer(gl.ARRAY_BUFFER, a.buf);
        gl.enableVertexAttribArray(a.loc);
        gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, a.stride || 0, a.offset || 0);
        gl.vertexAttribDivisor(a.loc, a.divisor || 0);
      }
      gl.bindVertexArray(null);
      return v;
    }
    /* интерливинг-буфер инстансов: layout = [[loc,size],...] */
    instanced(data, layout, usage) {
      const gl = this.gl;
      const buf = this.buffer(data, usage);
      const comps = layout.reduce((s, l) => s + l[1], 0);
      const stride = comps * 4;
      let off = 0;
      const attrs = layout.map(([loc, size]) => { const a = { buf, loc, size, stride, offset: off, divisor: 1 }; off += size * 4; return a; });
      const vao = this.vao(attrs, true);
      return { buf, vao, count: data.length / comps, comps };
    }

    texture2D(w, h, opts = {}) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      const ifmt = opts.internal || gl.RGBA16F, fmt = opts.format || gl.RGBA, type = opts.type || gl.HALF_FLOAT;
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, opts.data || null);
      const filt = opts.filter || gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.mipmap ? gl.LINEAR_MIPMAP_LINEAR : filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrapS || gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, opts.wrapT || gl.CLAMP_TO_EDGE);
      if (opts.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
      return t;
    }
    textureFromCanvas(cv, opts = {}) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, opts.wrapS || gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      return t;
    }
    target(w, h, opts = {}) {
      const gl = this.gl;
      const tex = this.texture2D(w, h, opts);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete: 0x' + st.toString(16));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fbo, tex, w, h };
    }
    deleteTarget(t) { if (!t) return; this.gl.deleteFramebuffer(t.fbo); this.gl.deleteTexture(t.tex); }
    bindTarget(t) {
      const gl = this.gl;
      if (t) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.viewport(0, 0, t.w, t.h); }
      else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height); }
    }
    fullscreen() { const gl = this.gl; gl.bindVertexArray(this.emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3); }

    // режимы смешивания
    blendAdd() { const gl = this.gl; gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE); }
    blendPremul() { const gl = this.gl; gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
    blendAbsorb() { const gl = this.gl; gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_COLOR); }
    blendAlpha() { const gl = this.gl; gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
    noBlend() { this.gl.disable(this.gl.BLEND); }
  }

  MW.GLContext = GLContext;
  MW.Program = Program;
})();
