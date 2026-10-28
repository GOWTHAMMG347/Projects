// Animated microscope field: drifting particles; microplastic-like ones get tracked detection boxes.
export function startField(canvas) {
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W, H, R, dpr, parts = [], raf = 0, last = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height; R = Math.min(W, H) / 2;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
    if (reduce) draw();
  }

  function seed() {
    parts = [];
    for (let i = 0; i < 48; i++) {
      const plastic = i < 7;
      const a = rnd(0, Math.PI * 2), d = Math.sqrt(Math.random()) * R * 0.82;
      const kind = plastic ? (i % 2 ? "fiber" : "frag") : (i % 3 ? "organic" : "grain");
      parts.push({
        x: W / 2 + Math.cos(a) * d, y: H / 2 + Math.sin(a) * d,
        vx: rnd(-8, 8), vy: rnd(-8, 8), rot: rnd(0, 6.28), vr: rnd(-0.25, 0.25),
        s: plastic ? rnd(9, 17) : rnd(4, 11), kind, plastic,
        conf: rnd(0.78, 0.97),
        shape: Array.from({ length: 6 }, (_, k) => [(k / 6) * 6.283, rnd(0.6, 1.1)]),
        hue: plastic ? rnd(190, 215) : rnd(60, 90),
      });
    }
  }

  function shapePath(p) {
    ctx.beginPath();
    if (p.kind === "fiber") {
      ctx.moveTo(-p.s * 1.7, 0);
      ctx.quadraticCurveTo(0, -p.s * 0.9, p.s * 1.7, p.s * 0.2);
    } else if (p.kind === "frag") {
      p.shape.forEach(([a, r], i) => {
        const x = Math.cos(a) * p.s * r, y = Math.sin(a) * p.s * r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath();
    } else if (p.kind === "organic") {
      ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, 6.283);
    } else {
      ctx.arc(0, 0, p.s * 0.45, 0, 6.283);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, R - 6, 0, 6.283); ctx.clip();
    const g = ctx.createRadialGradient(W / 2, H / 2, R * 0.1, W / 2, H / 2, R);
    g.addColorStop(0, "#1a5560"); g.addColorStop(1, "#0d3139");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    for (const p of parts) {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      shapePath(p);
      if (p.kind === "fiber") {
        ctx.strokeStyle = `hsla(${p.hue},75%,62%,.95)`; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.stroke();
      } else if (p.plastic) {
        ctx.fillStyle = `hsla(${p.hue},70%,60%,.85)`; ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1; ctx.stroke();
      } else {
        ctx.fillStyle = `hsla(${p.hue},22%,45%,.55)`; ctx.fill();
      }
      ctx.restore();
    }

    ctx.font = '600 11px "Public Sans", system-ui, sans-serif';
    ctx.textBaseline = "middle";
    for (const p of parts) {
      if (!p.plastic) continue;
      const h = p.s * (p.kind === "fiber" ? 1.9 : 1.25) + 5;
      ctx.strokeStyle = "#ff5a1f"; ctx.lineWidth = 1.6;
      ctx.strokeRect(p.x - h, p.y - h * 0.8, h * 2, h * 1.6);
      const label = p.conf.toFixed(2), tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = "#ff5a1f"; ctx.fillRect(p.x - h, p.y - h * 0.8 - 15, tw, 15);
      ctx.fillStyle = "#1a0a03"; ctx.fillText(label, p.x - h + 4, p.y - h * 0.8 - 7);
    }
    ctx.restore();

    // Lens ring + graduations
    ctx.strokeStyle = "rgba(233,243,242,.55)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, R - 5, 0, 6.283); ctx.stroke();
    ctx.lineWidth = 1;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * 6.283, len = i % 6 === 0 ? 10 : 5;
      ctx.beginPath();
      ctx.moveTo(W / 2 + Math.cos(a) * (R - 7), H / 2 + Math.sin(a) * (R - 7));
      ctx.lineTo(W / 2 + Math.cos(a) * (R - 7 - len), H / 2 + Math.sin(a) * (R - 7 - len));
      ctx.stroke();
    }
  }

  function tick(t) {
    const dt = Math.min((t - last) / 1000 || 0, 0.05); last = t;
    for (const p of parts) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const dx = p.x - W / 2, dy = p.y - H / 2, d = Math.hypot(dx, dy);
      if (d > R * 0.88) { // steer back inside the lens
        const k = 10 / d; p.vx = -dx * k * 0.8; p.vy = -dy * k * 0.8;
      }
    }
    draw();
    raf = requestAnimationFrame(tick);
  }

  new ResizeObserver(resize).observe(canvas);
  resize();
  if (!reduce) raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
