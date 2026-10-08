// Kaleidoscope engine (SPEC section 6): WebGL fragment shader with a Canvas2D fallback.
// Model: N wedges of 2π/N, odd wedges mirrored across their centre line; the photo is
// centred on the disc, scaled so its width = zoom × disc diameter, rotated by θ(t) and
// translated by an offset (image-width units) driven by idle drift + pointer steering.
import type { KaleidoParams } from './types';
import { reducedMotion, supportsWebGL } from './ui';

const VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;      // canvas size in px
uniform float uN;       // mirrors
uniform float uZoom;
uniform float uTheta;   // radians, clockwise
uniform vec2 uOffset;   // image-width units
const float PI = 3.141592653589793;
void main(){
  // y-down coordinates in disc-radius units, centre at 0
  vec2 p = vec2(gl_FragCoord.x / uRes.x * 2.0 - 1.0, 1.0 - gl_FragCoord.y / uRes.y * 2.0);
  float r = length(p);
  float edge = 1.5 / min(uRes.x, uRes.y) * 2.0;           // ~1.5px anti-aliased rim
  float mask = 1.0 - smoothstep(1.0 - edge, 1.0, r);
  if (mask <= 0.0) discard;
  float a = atan(p.x, -p.y);                              // angle from "up", clockwise positive
  float w = 2.0 * PI / uN;
  float k = floor((a + w * 0.5) / w);
  a = a - k * w;                                          // fold into base wedge [-w/2, w/2)
  if (mod(k, 2.0) >= 1.0) a = -a;                         // mirror odd wedges
  vec2 q = r * vec2(sin(a), -cos(a));                     // back to cartesian, base wedge
  float c = cos(-uTheta), s = sin(-uTheta);               // spin the source under the mirrors
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  vec2 uv = 0.5 + q * 0.5 / uZoom - uOffset;
  vec3 col = texture2D(uTex, uv).rgb;
  // inner vignette (≈ inset 0 0 90px rgba(0,0,0,.55) on a 680px disc)
  float v = 1.0 - 0.55 * pow(smoothstep(0.72, 1.0, r), 1.4);
  gl_FragColor = vec4(col * v * mask, mask);
}`;

interface Frame { theta: number; ox: number; oy: number; mirrors: number; zoom: number }

class GLRenderer {
  gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};
  constructor(public canvas: HTMLCanvasElement, opts: { preserve?: boolean } = {}) {
    const gl = (canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance' })
      || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link error');
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uTex', 'uRes', 'uN', 'uZoom', 'uTheta', 'uOffset']) this.u[n] = gl.getUniformLocation(prog, n);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([19, 18, 17]));
    gl.uniform1i(this.u.uTex, 0);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  setImage(img: HTMLImageElement | ImageBitmap): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    const pot = (v: number) => (v & (v - 1)) === 0;
    const w = (img as HTMLImageElement).naturalWidth || img.width, hh = (img as HTMLImageElement).naturalHeight || img.height;
    if (pot(w) && pot(hh)) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  draw(f: Frame): void {
    const gl = this.gl, c = this.canvas;
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uRes, c.width, c.height);
    gl.uniform1f(this.u.uN, f.mirrors); gl.uniform1f(this.u.uZoom, f.zoom);
    gl.uniform1f(this.u.uTheta, f.theta); gl.uniform2f(this.u.uOffset, f.ox, f.oy);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  dispose(): void { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}

/** Canvas2D fallback: clip-path wedges, like the prototype. */
class Canvas2DRenderer {
  ctx: CanvasRenderingContext2D;
  img: CanvasImageSource | null = null;
  constructor(public canvas: HTMLCanvasElement) { this.ctx = canvas.getContext('2d')!; }
  setImage(img: HTMLImageElement | ImageBitmap): void { this.img = img; }
  draw(f: Frame): void {
    const { ctx, canvas: c } = this; const W = c.width, H = c.height, R = Math.min(W, H) / 2;
    ctx.clearRect(0, 0, W, H);
    if (!this.img) return;
    const w = (2 * Math.PI) / f.mirrors, half = w / 2 + 0.006;
    const size = f.zoom * 2 * R;
    for (let i = 0; i < f.mirrors; i++) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(i * w);
      if (i % 2) ctx.scale(-1, 1);
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.sin(-half) * R * 1.05, -Math.cos(-half) * R * 1.05);
      ctx.lineTo(0, -R * 1.05);
      ctx.lineTo(Math.sin(half) * R * 1.05, -Math.cos(half) * R * 1.05);
      ctx.closePath(); ctx.clip();
      ctx.rotate(f.theta);
      ctx.drawImage(this.img, f.ox * size - size / 2, f.oy * size - size / 2, size, size);
      ctx.restore();
    }
    // mask to a disc + vignette
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
    ctx.restore();
    const g = ctx.createRadialGradient(W / 2, H / 2, R * 0.72, W / 2, H / 2, R);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  dispose(): void { /* nothing */ }
}

const imgCache = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imgCache.get(url);
  if (!p) {
    p = new Promise((res, rej) => {
      const im = new Image();
      im.crossOrigin = 'anonymous'; // WebGL textures need CORS-clean pixels (R2 bucket must allow the site origin)
      im.decoding = 'async';
      im.onload = () => res(im);
      im.onerror = () => rej(new Error(`Could not load ${url}`));
      im.src = url;
    });
    imgCache.set(url, p);
  }
  return p;
}

export class Kaleido {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private renderer: GLRenderer | Canvas2DRenderer;
  private params: KaleidoParams = { mirrors: 12, zoom: 1.8, speed: 12, paused: false, seed: 0 };
  private image: HTMLImageElement | null = null;
  private imageUrl = '';
  private t = 0; private theta = 0; private last = 0;
  private tx = 0; private ty = 0; private px = 0; private py = 0; // pointer target / eased
  private raf = 0; private visible = true; private dirty = true; private stopped = false; private frames = 0;
  private ro: ResizeObserver; private io: IntersectionObserver | null = null;
  private rm = reducedMotion();
  readonly isWebGL: boolean;
  private onVis = () => this.wake();

  constructor(opts: { label?: string; maxSize?: number } = {}) {
    this.canvas = document.createElement('canvas');
    this.el = document.createElement('div');
    this.el.className = 'kaleido';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', opts.label || 'Kaleidoscope made from a texture photograph');
    if (opts.maxSize) this.el.style.maxWidth = `${opts.maxSize}px`;
    this.el.appendChild(this.canvas);
    const rim = document.createElement('div'); rim.className = 'kaleido-rim'; rim.setAttribute('aria-hidden', 'true');
    this.el.appendChild(rim);
    let r: GLRenderer | Canvas2DRenderer;
    try { r = supportsWebGL() ? new GLRenderer(this.canvas) : new Canvas2DRenderer(this.canvas); }
    catch { r = new Canvas2DRenderer(this.canvas); }
    this.renderer = r;
    this.isWebGL = r instanceof GLRenderer;

    this.el.addEventListener('pointermove', (e) => {
      const b = this.el.getBoundingClientRect();
      this.tx = clamp(((e.clientX - b.left) / b.width - 0.5) * 2);
      this.ty = clamp(((e.clientY - b.top) / b.height - 0.5) * 2);
      this.wake();
    });
    this.ro = new ResizeObserver(() => { this.resize(); this.wake(); });
    this.ro.observe(this.el);
    if ('IntersectionObserver' in window) {
      this.io = new IntersectionObserver((ents) => { this.visible = ents[0].isIntersecting; if (this.visible) this.wake(); }, { threshold: 0.01 });
      this.io.observe(this.el);
    }
    document.addEventListener('visibilitychange', this.onVis);
    window.addEventListener('resize', this.onWinResize);
    this.resize();
  }
  private onWinResize = () => { this.resize(); this.wake(); };

  private resize(): void {
    const b = this.el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = Math.max(1, Math.round(Math.min(b.width, b.height || b.width) * dpr));
    if (this.canvas.width !== s || this.canvas.height !== s) { this.canvas.width = s; this.canvas.height = s; this.dirty = true; }
  }

  async setImage(url: string): Promise<void> {
    this.imageUrl = url;
    const img = await loadImage(url);
    if (this.imageUrl !== url || this.stopped) return; // superseded
    this.image = img;
    this.renderer.setImage(img);
    this.el.classList.add('is-ready');
    this.dirty = true; this.wake();
  }

  set(p: Partial<KaleidoParams>): void {
    Object.assign(this.params, p);
    this.dirty = true; this.wake();
  }
  get(): KaleidoParams { return { ...this.params }; }

  /** Current frame values (for export). */
  frame(): Frame {
    const z = this.params.zoom;
    const lim = (0.5 - 0.5 / z) * 0.94;
    const seed = this.params.seed;
    const still = this.rm;
    const dx = still ? 0 : Math.sin(this.t / 4700 + seed * 0.9);
    const dy = still ? 0 : Math.cos(this.t / 6100 + seed * 1.3);
    const ux = clamp(0.45 * dx + 0.8 * this.px), uy = clamp(0.45 * dy + 0.8 * this.py);
    return { theta: (this.theta * Math.PI) / 180, ox: ux * lim, oy: uy * lim, mirrors: this.params.mirrors, zoom: z };
  }

  private tick = (now: number): void => {
    this.raf = 0;
    if (this.stopped) return;
    const dt = Math.min(64, this.last ? now - this.last : 16); this.last = now;
    if (this.canvas.width <= 1 || (++this.frames & 31) === 0) this.resize(); // belt and braces if ResizeObserver is late
    const still = this.params.paused || this.rm;
    if (!still) { this.t += dt; this.theta = (this.theta + (dt * this.params.speed) / 1000) % 360; }
    const ex = this.tx - this.px, ey = this.ty - this.py;
    const settling = Math.abs(ex) > 0.0005 || Math.abs(ey) > 0.0005;
    this.px += ex * 0.07; this.py += ey * 0.07;
    if (!still || settling || this.dirty) {
      this.renderer.draw(this.frame());
      this.dirty = false;
    }
    const idle = (still && !settling) || !this.visible || document.hidden || !this.image;
    if (!idle) this.raf = requestAnimationFrame(this.tick);
    else this.last = 0;
  };

  wake(): void { if (!this.raf && !this.stopped) this.raf = requestAnimationFrame(this.tick); }

  /** Render the current frame at `size` px into a PNG blob (same shader, offscreen). */
  async exportPNG(size: number): Promise<Blob> {
    if (!this.image) throw new Error('No image loaded');
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    let r: GLRenderer | Canvas2DRenderer;
    try { r = this.isWebGL ? new GLRenderer(c, { preserve: true }) : new Canvas2DRenderer(c); } catch { r = new Canvas2DRenderer(c); }
    r.setImage(this.image);
    r.draw(this.frame());
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    r.dispose();
    if (!blob) throw new Error('Export failed');
    return blob;
  }

  destroy(): void {
    this.stopped = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect(); this.io?.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
    window.removeEventListener('resize', this.onWinResize);
    this.renderer.dispose();
    this.el.remove();
  }
}

const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
