const state = {
  current: null,
  busy: false,
  labels: { left: "no", right: "yes", skip: "skip" },
  hasUndo: false,
  pointer: null,
  done: false,
  renderToken: 0,
  mode: "annotate",
  reviewItems: [],
  reviewIndex: 0
};

const elements = {
  progressText: document.querySelector("#progressText"),
  remainingText: document.querySelector("#remainingText"),
  progressFill: document.querySelector("#progressFill"),
  reviewStage: document.querySelector("#reviewStage"),
  doneState: document.querySelector("#doneState"),
  actionBar: document.querySelector(".action-bar"),
  reviewBar: document.querySelector("#reviewBar"),
  commentPanel: document.querySelector("#commentPanel"),
  reviewStatus: document.querySelector("#reviewStatus"),
  reviewLabel: document.querySelector("#reviewLabel"),
  commentText: document.querySelector("#commentText"),
  card: document.querySelector("#card"),
  prompt: document.querySelector("#prompt"),
  filename: document.querySelector("#filename"),
  image: document.querySelector("#image"),
  imageFrame: document.querySelector("#imageFrame"),
  dragCue: document.querySelector("#dragCue"),
  metadata: document.querySelector("#metadata"),
  skipButton: document.querySelector("#skipButton"),
  undoButton: document.querySelector("#undoButton"),
  reviewButton: document.querySelector("#reviewButton"),
  noButton: document.querySelector("#noButton"),
  yesButton: document.querySelector("#yesButton"),
  annotateButton: document.querySelector("#annotateButton"),
  nextReviewButton: document.querySelector("#nextReviewButton"),
  saveCommentButton: document.querySelector("#saveCommentButton")
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
  if (data.comments) {
    elements.reviewButton.textContent = data.comments.missing > 0 ? `Review ${data.comments.missing}` : "Review";
  }
}

function labelDisplay(label) {
  if (label === "yes") return "Yes";
  if (label === "no") return "No";
  if (label === "skip") return "Skip";
  return label;
}

function setDone(done) {
  state.done = done;
  elements.reviewStage.hidden = done;
  elements.doneState.hidden = !done;
  elements.noButton.disabled = done;
  elements.yesButton.disabled = done;
  elements.skipButton.disabled = done;
  elements.undoButton.disabled = !state.hasUndo;
}

function setInteractionDisabled(disabled) {
  elements.noButton.disabled = disabled || state.done;
  elements.yesButton.disabled = disabled || state.done;
  elements.skipButton.disabled = disabled || state.done;
  elements.undoButton.disabled = disabled || !state.hasUndo;
  elements.reviewButton.disabled = disabled;
}

function setReviewDisabled(disabled) {
  elements.nextReviewButton.disabled = disabled;
  elements.saveCommentButton.disabled = disabled;
  elements.commentText.disabled = disabled;
}

function setMode(mode) {
  state.mode = mode;
  const isReview = mode === "review";
  elements.actionBar.hidden = isReview;
  elements.reviewBar.hidden = !isReview;
  elements.commentPanel.hidden = !isReview;
  elements.doneState.hidden = isReview || !state.done;
  elements.reviewStage.hidden = !isReview && state.done;
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

function loadImageElement(src, token) {
  return new Promise((resolve, reject) => {
    const onLoad = async () => {
      if (token !== state.renderToken) return;
      try {
        if (elements.image.decode) {
          await elements.image.decode();
        }
      } catch {
        // The load event is authoritative; decode can fail for already-decoded images.
      }
      resolve();
    };

    elements.image.onload = onLoad;
    elements.image.onerror = () => reject(new Error("Image failed to load"));
    elements.image.src = src;

    if (elements.image.complete && elements.image.naturalWidth > 0) {
      onLoad();
    }
  });
}

async function renderImage(image) {
  const token = state.renderToken + 1;
  state.renderToken = token;
  state.current = null;
  setInteractionDisabled(true);
  resetCardTransform();
  elements.imageFrame.classList.add("loading-image");
  elements.image.onload = null;
  elements.image.onerror = null;
  elements.image.hidden = true;
  elements.image.removeAttribute("src");
  elements.image.alt = "";

  elements.prompt.textContent = image.prompt || image.filename;
  elements.filename.textContent = image.filename;
  const metadata = [image.meaning, image.category].filter(Boolean).join(" | ");
  elements.metadata.textContent = metadata;

  await loadImageElement(`${image.imageUrl}?v=${encodeURIComponent(image.id)}`, token);
  if (token !== state.renderToken) return;

  elements.image.alt = image.prompt || image.filename;
  elements.image.hidden = false;
  elements.imageFrame.classList.remove("loading-image");
  state.current = image;
  setInteractionDisabled(false);
}

async function loadNext() {
  setMode("annotate");
  const data = await api("/api/next");
  updateProgress(data);
  setDone(data.done);

  if (data.image) {
    await renderImage(data.image);
  } else {
    state.current = null;
  }
}

async function annotate(label, direction) {
  if (state.busy || !state.current || state.mode !== "annotate") return;

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
  if (state.busy || state.mode !== "annotate") return;
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
  if (state.busy || !state.current || state.mode !== "annotate" || elements.reviewStage.hidden) return;

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
  if (state.mode === "review" && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
    saveCommentAndNext();
  } else if (state.mode !== "annotate") {
    return;
  } else if (event.key === "ArrowRight") {
    annotate(state.labels.right, "right");
  } else if (event.key === "ArrowLeft") {
    annotate(state.labels.left, "left");
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    undo();
  }
}

function reviewStats() {
  const total = state.reviewItems.length;
  const commented = state.reviewItems.filter((item) => (item.comment || "").trim().length > 0).length;
  return {
    total,
    commented,
    missing: total - commented
  };
}

function updateReviewHeader() {
  const stats = reviewStats();
  const item = state.reviewItems[state.reviewIndex];
  elements.reviewStatus.textContent = stats.total
    ? `Comments ${stats.commented}/${stats.total} saved, ${stats.missing} missing`
    : "No no/skip images to review";
  elements.reviewLabel.textContent = item ? labelDisplay(item.label) : "";
}

function nextReviewIndex(startIndex, missingOnly = false) {
  if (state.reviewItems.length === 0) return 0;
  for (let offset = 1; offset <= state.reviewItems.length; offset += 1) {
    const index = (startIndex + offset) % state.reviewItems.length;
    const item = state.reviewItems[index];
    if (!missingOnly || !(item.comment || "").trim()) {
      return index;
    }
  }
  return (startIndex + 1) % state.reviewItems.length;
}

async function renderReviewItem(index) {
  if (state.reviewItems.length === 0) {
    state.current = null;
    elements.prompt.textContent = "No no/skip images";
    elements.filename.textContent = "";
    elements.metadata.textContent = "";
    elements.imageFrame.classList.remove("loading-image");
    elements.image.hidden = true;
    elements.image.removeAttribute("src");
    elements.image.alt = "";
    elements.commentText.value = "";
    updateReviewHeader();
    setReviewDisabled(true);
    return;
  }

  state.reviewIndex = index;
  const item = state.reviewItems[state.reviewIndex];
  setReviewDisabled(true);
  elements.commentText.value = item.comment || "";
  updateReviewHeader();
  await renderImage(item);
  updateReviewHeader();
  setReviewDisabled(false);
  elements.commentText.focus();
}

async function enterReviewMode() {
  if (state.busy) return;
  state.busy = true;
  try {
    setMode("review");
    const data = await api("/api/review/items");
    updateProgress(data);
    state.reviewItems = data.items || [];
    const firstMissing = state.reviewItems.findIndex((item) => !(item.comment || "").trim());
    await renderReviewItem(firstMissing === -1 ? 0 : firstMissing);
  } catch (error) {
    alert(`Could not load review items: ${error.message}`);
    setMode("annotate");
  } finally {
    state.busy = false;
  }
}

async function saveCommentAndNext() {
  if (state.busy || state.mode !== "review" || state.reviewItems.length === 0) return;
  const item = state.reviewItems[state.reviewIndex];
  const comment = elements.commentText.value;

  state.busy = true;
  setReviewDisabled(true);
  try {
    const data = await api("/api/comment", {
      method: "POST",
      body: JSON.stringify({ id: item.id, comment })
    });
    updateProgress(data);
    item.comment = comment;
    updateReviewHeader();
    await renderReviewItem(nextReviewIndex(state.reviewIndex, true));
  } catch (error) {
    alert(`Could not save comment: ${error.message}`);
    setReviewDisabled(false);
  } finally {
    state.busy = false;
  }
}

async function nextReviewItem() {
  if (state.busy || state.mode !== "review" || state.reviewItems.length === 0) return;
  state.busy = true;
  try {
    await renderReviewItem(nextReviewIndex(state.reviewIndex, false));
  } finally {
    state.busy = false;
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
elements.reviewButton.addEventListener("click", enterReviewMode);
elements.annotateButton.addEventListener("click", loadNext);
elements.nextReviewButton.addEventListener("click", nextReviewItem);
elements.saveCommentButton.addEventListener("click", saveCommentAndNext);
window.addEventListener("keydown", handleKeydown);

loadNext().catch((error) => {
  elements.progressText.textContent = "Load failed";
  alert(`Could not load annotator: ${error.message}`);
});
