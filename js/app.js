(function () {
  const video = document.getElementById('video');
  const draw = document.getElementById('draw');
  const overlay = document.getElementById('overlay');

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const saveBtn = document.getElementById('saveBtn');
  const undoBtn = document.getElementById('undoBtn');

  const size = document.getElementById('size');
  const sizeVal = document.getElementById('sizeVal');
  const color = document.getElementById('color');
  const smooth = document.getElementById('smooth');
  const smoothVal = document.getElementById('smoothVal');
  const mode = document.getElementById('mode');
  const mirror = document.getElementById('mirror');

  const fpsEl = document.getElementById('fps');
  const statusPill = document.getElementById('statusPill');

  const dctx = draw.getContext('2d');
  const octx = overlay.getContext('2d');

  let camera = null;
  let hands = null;
  let running = false;

  let lastPt = null;
  let penDown = false;

  let strokes = [];
  let currentStroke = null;

  let lastTime = performance.now();
  let frames = 0;

  function fitCanvases() {
    const rect = document.getElementById('stage').getBoundingClientRect();
    [draw, overlay].forEach((c) => {
      c.width = rect.width;
      c.height = rect.height;
    });
    octx.clearRect(0, 0, overlay.width, overlay.height);
  }
  window.addEventListener('resize', fitCanvases);
  fitCanvases();

  function updateUI() {
    sizeVal.textContent = `${size.value} px`;
    smoothVal.textContent = `${smooth.value}`;
  }
  updateUI();
  size.addEventListener('input', updateUI);
  smooth.addEventListener('input', updateUI);


  const lerp = (a, b, t) => a + (b - a) * t;
  function smoothTo(prev, next, s) {
    if (!prev) return next;
    return { x: lerp(prev.x, next.x, 1 - s), y: lerp(prev.y, next.y, 1 - s) };
  }

  function toCanvasCoords(norm) {
    const mirrored = mirror.value === 'on';
    const x = (mirrored ? (1 - norm.x) : norm.x) * overlay.width;
    const y = norm.y * overlay.height;
    return { x, y };
  }

  function startStroke(pt) {
    currentStroke = {
      color: color.value,
      width: parseInt(size.value, 10),
      pts: [pt],
    };
    strokes.push(currentStroke);

    dctx.strokeStyle = currentStroke.color;
    dctx.lineWidth = currentStroke.width;
    dctx.lineCap = 'round';
    dctx.lineJoin = 'round';
    dctx.shadowBlur = 10;
    dctx.shadowColor = currentStroke.color;

    dctx.beginPath();
    dctx.moveTo(pt.x, pt.y);
  }

  function extendStroke(pt) {
    if (!currentStroke) return;
    currentStroke.pts.push(pt);
    dctx.lineTo(pt.x, pt.y);
    dctx.stroke();
  }

  function endStroke() {
    if (currentStroke) {
      dctx.closePath();
      currentStroke = null;
    }
    dctx.shadowBlur = 0;
  }

  function redrawAll() {
    dctx.clearRect(0, 0, draw.width, draw.height);

    for (const s of strokes) {
      dctx.strokeStyle = s.color;
      dctx.lineWidth = s.width;
      dctx.lineCap = 'round';
      dctx.lineJoin = 'round';
      dctx.shadowBlur = 10;
      dctx.shadowColor = s.color;

      dctx.beginPath();
      for (let i = 0; i < s.pts.length; i++) {
        const p = s.pts[i];
        if (i === 0) dctx.moveTo(p.x, p.y);
        else dctx.lineTo(p.x, p.y);
      }
      dctx.stroke();
      dctx.closePath();
      dctx.shadowBlur = 0;
    }
  }

  function clearCanvas() {
    strokes = [];
    redrawAll();
  }

  function undo() {
    strokes.pop();
    redrawAll();
  }

  clearBtn.addEventListener('click', clearCanvas);
  undoBtn.addEventListener('click', undo);

  saveBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.download = `dibujo_${Date.now()}.png`;
    a.href = draw.toDataURL('image/png');
    a.click();
  });

  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'c') clearCanvas();
    if (k === 'z') undo();
    if (k === 's') saveBtn.click();
  });

  function drawOverlayResults(results) {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    if (!results.multiHandLandmarks) return;

    results.multiHandLandmarks.forEach((lm) => {
      if (window.drawConnectors) {
        const mpLm = lm.map((p) => ({ x: p.x, y: p.y }));
        window.drawConnectors(octx, mpLm, window.HAND_CONNECTIONS, { color: '#9e2d4a', lineWidth: 3 });
        window.drawLandmarks(octx, mpLm, { color: '#feffd4', lineWidth: 1, radius: 2 });
      }
    });
  }

  function drawCursor(pt, active) {
    octx.save();
    octx.beginPath();
    octx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
    octx.shadowBlur = 16;
    octx.shadowColor = active ? '#c5b89f' : '#9e2d4a';
    octx.fillStyle = active ? '#c5b89f' : '#9e2d4a';
    octx.fill();
    octx.closePath();
    octx.restore();
  }

  function onResults(results) {
    frames++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
      fpsEl.textContent = String(frames);
      frames = 0;
      lastTime = now;
    }

    drawOverlayResults(results);

    const handsLm = (results.multiHandLandmarks && results.multiHandLandmarks[0]) || null;
    if (!handsLm) {
      lastPt = null;
      endStroke();
      penDown = false;
      return;
    }

    const idx = handsLm[8];
    const thb = handsLm[4];

    const idxPt = toCanvasCoords(idx);
    const thbPt = toCanvasCoords(thb);

    lastPt = smoothTo(lastPt, idxPt, parseFloat(smooth.value));

    if (mode.value === 'always') {
      penDown = true;
    } else if (mode.value === 'hover') {
      penDown = false;
    } else {
      const diag = Math.hypot(overlay.width, overlay.height);
      penDown = Math.hypot(idxPt.x - thbPt.x, idxPt.y - thbPt.y) < diag * 0.035;
    }


    drawCursor(lastPt, penDown);

    if (penDown) {
      if (!currentStroke) startStroke(lastPt);
      else extendStroke(lastPt);
    } else {
      endStroke();
    }
  }

  async function start() {
    if (running) return;
    running = true;
    statusPill.textContent = 'Estado: en vivo';

    fitCanvases();

    hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.6,
    });

    hands.onResults(onResults);

    camera = new Camera(video, {
      onFrame: async () => {
        await hands.send({ image: video });
      },
      width: overlay.width,
      height: overlay.height,
    });

    await camera.start();
  }

  async function stop() {
    running = false;
    statusPill.textContent = 'Estado: detenido';

    try { await camera.stop(); } catch {}
    try { hands.close(); } catch {}

    camera = null;
    hands = null;
    lastPt = null;
    endStroke();
    octx.clearRect(0, 0, overlay.width, overlay.height);
  }

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
})();
