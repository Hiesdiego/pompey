/** A short, self-cleaning celebration after a confirmed claim. */
export function celebrateClaim() {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:200";
  context.scale(ratio, ratio);
  document.body.appendChild(canvas);

  const colors = ["#2E7CF6", "#7FE0BD", "#F59E0B", "#FFFFFF", "#EF4444"];
  const particles = Array.from({ length: 90 }, () => {
    const direction = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 9;
    return {
      x: width / 2,
      y: height * 0.38,
      vx: Math.cos(direction) * speed,
      vy: Math.sin(direction) * speed - 4,
      size: 4 + Math.random() * 5,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.2,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  });
  const start = performance.now();
  let frame = 0;
  const draw = (now: number) => {
    const elapsed = now - start;
    if (elapsed > 2200 || !canvas.isConnected) {
      canvas.remove();
      return;
    }
    context.clearRect(0, 0, width, height);
    context.globalAlpha = Math.min(1, (2200 - elapsed) / 450);
    for (const particle of particles) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vx *= 0.99;
      particle.vy += 0.16;
      particle.rotation += particle.spin;
      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;
      context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.6);
      context.restore();
    }
    frame = window.requestAnimationFrame(draw);
  };
  frame = window.requestAnimationFrame(draw);
  window.setTimeout(() => {
    window.cancelAnimationFrame(frame);
    canvas.remove();
  }, 2400);
}
