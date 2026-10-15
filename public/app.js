const $ = (selector) => document.querySelector(selector);

const state = {
  model: "",
  analysis: null,
  exercise: null,
  nextExercise: null,
  exerciseNumber: 1,
};

const usage = JSON.parse(localStorage.getItem("sspEnglishUsage") || '{"transcripts":0,"exercises":0}');

function saveUsage() {
  localStorage.setItem("sspEnglishUsage", JSON.stringify(usage));
  $("#usage").textContent = `Đã học: ${usage.transcripts} transcript · ${usage.exercises} câu`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Có lỗi xảy ra.");
  return result;
}

function setBusy(button, status, busy, message = "") {
  button.disabled = busy;
  status.textContent = message;
  status.classList.remove("error");
}

function showError(status, error) {
  status.textContent = error.message;
  status.classList.add("error");
}

async function loadModels() {
  const select = $("#model");
  try {
    const { models } = await api("/api/models");
    if (!models.length) throw new Error("Ollama chưa có model nào.");
    select.innerHTML = "";
    const ordered = [...models].sort((a, b) => {
      if (a.startsWith("qwen3.5:4b")) return -1;
      if (b.startsWith("qwen3.5:4b")) return 1;
      return a.localeCompare(b);
    });
    for (const model of ordered) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      select.append(option);
    }
    state.model = select.value;
    select.dispatchEvent(new Event("change"));
  } catch (error) {
    select.innerHTML = `<option>${error.message}</option>`;
    select.disabled = true;
    showError($("#input-status"), error);
  }
}

function renderAnalysis(analysis) {
  $("#overall").textContent = analysis.overall;
  $("#strengths").innerHTML = `
    <strong>Điểm đang làm tốt</strong>
    <ul>${analysis.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  `;
  $("#focus-areas").innerHTML = analysis.focusAreas.map((area, index) => `
    <article class="focus-card">
      <h3>${index + 1}. ${escapeHtml(area.title)}</h3>
      <p>${escapeHtml(area.why)}</p>
      <div class="before">${escapeHtml(area.exampleOriginal)}</div>
      <div class="after">${escapeHtml(area.exampleCorrected)}</div>
      <p class="rule">${escapeHtml(area.rule)}</p>
    </article>
  `).join("");
}

function renderExercise(exercise) {
  state.exercise = exercise;
  $("#exercise-number").textContent = `Bài ${state.exerciseNumber}`;
  $("#exercise-target").textContent = exercise.target;
  $("#exercise-text").textContent = exercise.vietnamese;
  $("#exercise-context").textContent = exercise.context;
  $("#answer").value = "";
  $("#feedback").hidden = true;
  $("#answer-status").textContent = "";
  $("#answer").focus();
}

function renderFeedback(result) {
  $("#verdict").textContent = result.understandable ? "Ý của bạn hiểu được" : "Ý chưa đủ rõ";
  $("#corrected").textContent = result.corrected;
  $("#natural").textContent = result.natural;
  $("#feedback-list").innerHTML = result.feedback.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  $("#feedback").hidden = false;
  state.nextExercise = result.nextExercise;
  $("#feedback").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function escapeHtml(value = "") {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

$("#model").addEventListener("change", (event) => { state.model = event.target.value; });

$("#analyze").addEventListener("click", async () => {
  const button = $("#analyze");
  const status = $("#input-status");
  const transcript = $("#transcript").value.trim();
  if (!transcript) return showError(status, new Error("Hãy dán transcript trước."));

  setBusy(button, status, true, "AI đang đọc transcript. Lần đầu có thể mất một lúc…");
  try {
    state.model = $("#model").value;
    state.analysis = await api("/api/analyze", {
      method: "POST",
      body: JSON.stringify({
        transcript,
        learnerName: $("#learner-name").value.trim() || "Andie Nguyen",
        model: state.model,
      }),
    });
    state.exercise = state.analysis.exercise;
    usage.transcripts += 1;
    saveUsage();
    renderAnalysis(state.analysis);
    $("#lesson-stage").hidden = false;
    $("#lesson-stage").scrollIntoView({ behavior: "smooth" });
    setBusy(button, status, false, "Đã tạo xong bài học.");
  } catch (error) {
    button.disabled = false;
    showError(status, error);
  }
});

$("#start-practice").addEventListener("click", () => {
  state.exerciseNumber = 1;
  $("#practice-stage").hidden = false;
  renderExercise(state.analysis.exercise);
  $("#practice-stage").scrollIntoView({ behavior: "smooth" });
});

$("#check-answer").addEventListener("click", async () => {
  const button = $("#check-answer");
  const status = $("#answer-status");
  const answer = $("#answer").value.trim();
  if (!answer) return showError(status, new Error("Hãy viết câu trả lời trước."));

  setBusy(button, status, true, "AI đang kiểm tra…");
  try {
    const result = await api("/api/answer", {
      method: "POST",
      body: JSON.stringify({
        model: state.model,
        exercise: state.exercise,
        answer,
        focusAreas: state.analysis.focusAreas,
      }),
    });
    renderFeedback(result);
    usage.exercises += 1;
    saveUsage();
    setBusy(button, status, false, "");
  } catch (error) {
    button.disabled = false;
    showError(status, error);
  }
});

$("#next-exercise").addEventListener("click", () => {
  state.exerciseNumber += 1;
  renderExercise(state.nextExercise);
  $("#practice-stage").scrollIntoView({ behavior: "smooth" });
});

saveUsage();
loadModels();
