const state = {
  current: null,
  busy: false,
  labels: { left: "no", right: "yes", skip: "skip" },
  hasUndo: false,
  pointer: null
};

const elements = {
  progressText: document.querySelector("#progressText"),
  remainingText: document.querySelector("#remainingText"),
  progressFill: document.querySelector("#progressFill"),
  reviewStage: document.querySelector("#reviewStage"),
  doneState: document.querySelector("#doneState"),
  card: document.querySelector("#card"),
  prompt: document.querySelector("#prompt"),
  filename: document.querySelector("#filename"),
  image: document.querySelector("#image"),
  imageFrame: document.querySelector("#imageFrame"),
  dragCue: document.querySelector("#dragCue"),
  metadata: document.querySelector("#metadata"),
  skipButton: document.querySelector("#skipButton"),
  undoButton: document.querySelector("#undoButton"),
  noButton: document.querySelector("#noButton"),
  yesButton: document.querySelector("#yesButton")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

function updateProgress(data) {
  const total = data.total || 0;
  const annotated = data.annotated || 0;
  const remaining = data.remaining || 0;
  const percent = total ? Math.round((annotated / total) * 100) : 0;

  elements.progressText.textContent = `${annotated} / ${total} annotated`;
  elements.remainingText.textContent = remaining ? `${remaining} left` : "";
  elements.progressFill.style.width = `${percent}%`;
  state.labels = data.labels || state.labels;
  elements.noButton.textContent = labelDisplay(state.labels.left);
  elements.yesButton.textContent = labelDisplay(state.labels.right);
  elements.skipButton.textContent = labelDisplay(state.labels.skip);
  state.hasUndo = Boolean(data.canUndo);
  elements.undoButton.disabled = !state.hasUndo;
}

function labelDisplay(label) {
  if (label === "yes") return "Yes";
  if (label === "no") return "No";
  if (label === "skip") return "Skip";
  return label;
}

function setDone(done) {
  elements.reviewStage.hidden = done;
  elements.doneState.hidden = !done;
  elements.noButton.disabled = done;
  elements.yesButton.disabled = done;
  elements.skipButton.disabled = done;
}

function setCardTransform(deltaX, deltaY = 0) {
  const rotate = Math.max(-14, Math.min(14, deltaX / 16));
  elements.card.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotate}deg)`;
}

function resetCardTransform() {
  elements.card.classList.remove("dragging");
  elements.card.style.transform = "";
  elements.card.style.opacity = "";
  elements.dragCue.className = "drag-cue";
  elements.dragCue.textContent = "";
  elements.dragCue.style.opacity = "0";
}

function showCue(deltaX) {
  const threshold = 36;
  if (Math.abs(deltaX) < threshold) {
    elements.dragCue.className = "drag-cue";
    elements.dragCue.textContent = "";
    elements.dragCue.style.opacity = "0";
    return;
  }

  const isYes = deltaX > 0;
  elements.dragCue.className = `drag-cue ${isYes ? "yes" : "no"}`;
  elements.dragCue.textContent = isYes ? labelDisplay(state.labels.right) : labelDisplay(state.labels.left);
  elements.dragCue.style.opacity = String(Math.min(1, Math.abs(deltaX) / 110));
}

function renderImage(image) {
  state.current = image;
  elements.prompt.textContent = image.prompt || image.filename;
  elements.filename.textContent = image.filename;
  elements.image.alt = image.prompt || image.filename;
  elements.image.src = `${image.imageUrl}?v=${encodeURIComponent(image.id)}`;

  const metadata = [image.meaning, image.category].filter(Boolean).join(" | ");
  elements.metadata.textContent = metadata;
  resetCardTransform();
}

async function loadNext() {
  const data = await api("/api/next");
  updateProgress(data);
  setDone(data.done);

  if (data.image) {
    renderImage(data.image);
  }
}

async function annotate(label, direction) {
  if (state.busy || !state.current) return;

  state.busy = true;
  const exitX = direction === "right" ? window.innerWidth : direction === "left" ? -window.innerWidth : 0;
  const exitY = direction === "skip" ? -window.innerHeight * 0.35 : -10;
  elements.card.style.opacity = "0";
  setCardTransform(exitX, exitY);

  try {
    const data = await api("/api/annotate", {
      method: "POST",
      body: JSON.stringify({ id: state.current.id, label })
    });
    updateProgress(data);
    await loadNext();
  } catch (error) {
    alert(`Could not save annotation: ${error.message}`);
    resetCardTransform();
  } finally {
    state.busy = false;
  }
}

async function undo() {
  if (state.busy) return;
  state.busy = true;
  try {
    const data = await api("/api/undo", { method: "POST", body: "{}" });
    updateProgress(data);
    await loadNext();
  } catch (error) {
    alert(`Could not undo: ${error.message}`);
  } finally {
    state.busy = false;
  }
}

function pointerDown(event) {
  if (state.busy || !state.current || elements.reviewStage.hidden) return;

  state.pointer = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY
  };
  elements.card.classList.add("dragging");
  elements.card.setPointerCapture(event.pointerId);
}

function pointerMove(event) {
  if (!state.pointer || event.pointerId !== state.pointer.id) return;

  state.pointer.lastX = event.clientX;
  state.pointer.lastY = event.clientY;
  const deltaX = event.clientX - state.pointer.startX;
  const deltaY = event.clientY - state.pointer.startY;
  setCardTransform(deltaX, deltaY * 0.25);
  showCue(deltaX);
}

function pointerUp(event) {
  if (!state.pointer || event.pointerId !== state.pointer.id) return;

  const deltaX = state.pointer.lastX - state.pointer.startX;
  state.pointer = null;
  elements.card.releasePointerCapture(event.pointerId);
  elements.card.classList.remove("dragging");

  const threshold = Math.min(130, Math.max(72, window.innerWidth * 0.22));
  if (deltaX > threshold) {
    annotate(state.labels.right, "right");
  } else if (deltaX < -threshold) {
    annotate(state.labels.left, "left");
  } else {
    resetCardTransform();
  }
}

function handleKeydown(event) {
  if (event.key === "ArrowRight") {
    annotate(state.labels.right, "right");
  } else if (event.key === "ArrowLeft") {
    annotate(state.labels.left, "left");
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    undo();
  }
}

elements.card.addEventListener("pointerdown", pointerDown);
elements.card.addEventListener("pointermove", pointerMove);
elements.card.addEventListener("pointerup", pointerUp);
elements.card.addEventListener("pointercancel", resetCardTransform);
elements.skipButton.addEventListener("click", () => annotate(state.labels.skip, "skip"));
elements.noButton.addEventListener("click", () => annotate(state.labels.left, "left"));
elements.yesButton.addEventListener("click", () => annotate(state.labels.right, "right"));
elements.undoButton.addEventListener("click", undo);
window.addEventListener("keydown", handleKeydown);

loadNext().catch((error) => {
  elements.progressText.textContent = "Load failed";
  alert(`Could not load annotator: ${error.message}`);
});
