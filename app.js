"use strict";

const STORAGE_KEY = "taskpoints.tasks.v1";
const POINTS_STORAGE_KEY = "taskpoints.points.v1";

// ---------------------------------------------------------------------------
// Análisis de dificultad (1 = más baja, 10 = más alta)
// ---------------------------------------------------------------------------

const COMPLEX_KEYWORDS = [
  "planificar", "estrategia", "diseñar", "arquitectura", "investigar", "analizar",
  "presupuesto", "negociar", "preséntacion", "presentacion", "informe", "propuesta",
  "optimizar", "refactorizar", "migrar", "integrar", "desplegar", "auditar",
  "contratar", "formación", "formacion", "certificación", "certificacion", "examen",
  "tesis", "proyecto", "reunión", "reunion", "cliente", "legal", "impuestos",
];

const SIMPLE_KEYWORDS = [
  "llamar", "escribir", "responder", "revisar", "comprar", "recoger", "enviar",
  "limpiar", "ordenar", "regar", "pasear", "pagar", "firmar", " imprimir",
];

const CATEGORY_WEIGHT = {
  trabajo: 1.15,
  estudio: 1.1,
  hogar: 0.95,
  personal: 1.0,
  otro: 1.0,
};

const PRIORITY_BONUS = {
  critica: 1.2,
  alta: 1.1,
  media: 1.0,
  baja: 0.9,
};

/**
 * Analiza una tarea y devuelve dificultad 1-10, desglose y puntos base.
 */
function analyzeTask(task) {
  const breakdown = [];

  // 1) Duración estimada: eje principal del análisis (0-5 puntos)
  const hours = Math.max(0.25, Number(task.duration) || 0.25);
  let durationScore;
  if (hours <= 0.5) durationScore = 1;
  else if (hours <= 1) durationScore = 1.5;
  else if (hours <= 2) durationScore = 2.5;
  else if (hours <= 4) durationScore = 3.5;
  else if (hours <= 8) durationScore = 4.5;
  else durationScore = 5;
  breakdown.push({ label: `Duración (${hours} h)`, score: durationScore, max: 5 });

  // 2) Complejidad del texto: palabras clave y longitud (0-3 puntos)
  const text = `${task.title} ${task.description || ""}`.toLowerCase();
  let textScore = 0;
  const complexHits = COMPLEX_KEYWORDS.filter((k) => text.includes(k));
  const simpleHits = SIMPLE_KEYWORDS.filter((k) => text.trim().includes(k.trim()));
  textScore += Math.min(1.5, complexHits.length * 0.75);
  textScore += Math.min(1, task.description ? task.description.trim().split(/\s+/).length / 40 : 0);
  textScore -= Math.min(0.5, simpleHits.length * 0.25);
  textScore = Math.max(0, Math.min(3, textScore));
  breakdown.push({
    label: complexHits.length ? `Complejidad (${complexHits.slice(0, 3).join(", ")})` : "Complejidad del texto",
    score: textScore,
    max: 3,
  });

  // 3) Prioridad (0-1.5 puntos)
  const priorityScore = { critica: 1.5, alta: 1.1, media: 0.7, baja: 0.4 }[task.priority] ?? 0.7;
  breakdown.push({ label: `Prioridad (${task.priority})`, score: priorityScore, max: 1.5 });

  // 4) Urgencia por plazo (0-0.5 puntos)
  let urgencyScore = 0.15;
  if (task.deadline) {
    const days = Math.ceil((new Date(task.deadline) - Date.now()) / 86400000);
    if (days <= 0) urgencyScore = 0.5;
    else if (days <= 1) urgencyScore = 0.4;
    else if (days <= 3) urgencyScore = 0.3;
    else if (days <= 7) urgencyScore = 0.2;
    else urgencyScore = 0.1;
    breakdown.push({ label: `Plazo (${days <= 0 ? "vencido/hoy" : days + " días"})`, score: urgencyScore, max: 0.5 });
  } else {
    breakdown.push({ label: "Sin plazo definido", score: urgencyScore, max: 0.5 });
  }

  // Suma ponderada por categoría → escala 1-10
  const raw = breakdown.reduce((sum, b) => sum + b.score, 0);
  const weighted = raw * (CATEGORY_WEIGHT[task.category] ?? 1);
  const difficulty = Math.max(1, Math.min(10, Math.round(weighted * 1.25)));

  const points = difficulty * 10;

  return { difficulty, breakdown, points };
}

/**
 * Puntos finales al completar: base por dificultad + bonos.
 */
function calculateReward(task) {
  let bonus = 0;
  const bonusLines = [];

  if (task.deadline) {
    const daysLate = Math.ceil((Date.now() - new Date(task.deadline)) / 86400000);
    if (daysLate <= 0) {
      bonus += Math.round(task.points * 0.2);
      bonusLines.push("Bono por entregar a tiempo: +20%");
    } else {
      bonus -= Math.round(task.points * 0.2);
      bonusLines.push("Penalización por retraso: -20%");
    }
  }

  if (task.difficulty >= 8) {
    bonus += 15;
    bonusLines.push("Bono por tarea muy difícil: +15");
  }

  return { total: Math.max(5, task.points + bonus), bonusLines };
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

function loadState() {
  try {
    return {
      tasks: JSON.parse(localStorage.getItem(STORAGE_KEY)) || [],
      totalPoints: Number(localStorage.getItem(POINTS_STORAGE_KEY)) || 0,
    };
  } catch {
    return { tasks: [], totalPoints: 0 };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  localStorage.setItem(POINTS_STORAGE_KEY, String(state.totalPoints));
}

const state = loadState();

// ---------------------------------------------------------------------------
// Niveles: cada nivel cuesta 100 × nivel puntos
// ---------------------------------------------------------------------------

function levelInfo(points) {
  let level = 1;
  let remaining = points;
  while (remaining >= level * 100) {
    remaining -= level * 100;
    level += 1;
  }
  const needed = level * 100;
  return { level, progress: Math.round((remaining / needed) * 100), remaining, needed };
}

// ---------------------------------------------------------------------------
// Renderizado
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const taskForm = $("#task-form");
const taskList = $("#task-list");
const emptyState = $("#empty-state");
const analysisPreview = $("#analysis-preview");
let currentFilter = "todas";

function difficultyClass(d) {
  if (d <= 3) return "d1";
  if (d <= 6) return "d4";
  if (d <= 8) return "d7";
  return "d9";
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

function render() {
  renderStats();
  renderTasks();
  saveState();
}

function renderStats() {
  const completed = state.tasks.filter((t) => t.completed);
  const info = levelInfo(state.totalPoints);
  $("#stat-points").textContent = state.totalPoints;
  $("#stat-level").textContent = info.level;
  $("#stat-completed").textContent = completed.length;
  $("#stat-pending").textContent = state.tasks.length - completed.length;
  $("#level-progress").style.width = info.progress + "%";
  $("#level-hint").textContent = `Nivel ${info.level}: te faltan ${info.remaining} puntos para el nivel ${info.level + 1} (${info.needed} en total).`;
}

function renderTasks() {
  let tasks = [...state.tasks];

  if (currentFilter === "pendientes") tasks = tasks.filter((t) => !t.completed);
  else if (currentFilter === "completadas") tasks = tasks.filter((t) => t.completed);
  else if (currentFilter === "dificultad") tasks.sort((a, b) => b.difficulty - a.difficulty);

  emptyState.classList.toggle("hidden", tasks.length > 0);
  taskList.innerHTML = "";

  for (const task of tasks) {
    const li = document.createElement("li");
    li.className = "task-item" + (task.completed ? " completed" : "");

    const badge = document.createElement("div");
    badge.className = `difficulty-badge ${difficultyClass(task.difficulty)}`;
    badge.innerHTML = `${task.difficulty}<small>dif.</small>`;

    const main = document.createElement("div");
    main.className = "task-main";
    const meta = [
      `⏱ ${task.duration} h`,
      `🏷 ${task.category}`,
      `⚡ ${task.priority}`,
      task.deadline ? `📅 ${formatDate(task.deadline)}` : null,
      task.completedAt ? `✅ ${formatDate(task.completedAt.slice(0, 10))}` : null,
    ].filter(Boolean).join(" · ");
    main.innerHTML = `
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-meta">${meta}</div>
      <div class="task-meta"><span class="points-badge">${task.completed ? "+" + task.awardedPoints : task.points} pts</span></div>
    `;
    if (task.description) {
      const desc = document.createElement("div");
      desc.className = "task-meta";
      desc.textContent = task.description;
      main.appendChild(desc);
    }

    const actions = document.createElement("div");
    actions.className = "task-actions";
    if (!task.completed) {
      const doneBtn = document.createElement("button");
      doneBtn.className = "btn complete";
      doneBtn.textContent = "Completar";
      doneBtn.addEventListener("click", () => completeTask(task.id));
      actions.appendChild(doneBtn);
    }
    const delBtn = document.createElement("button");
    delBtn.className = "btn delete";
    delBtn.textContent = "✕";
    delBtn.title = "Eliminar";
    delBtn.addEventListener("click", () => deleteTask(task.id));
    actions.appendChild(delBtn);

    li.append(badge, main, actions);
    taskList.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

taskForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const task = {
    id: crypto.randomUUID(),
    title: $("#title").value.trim(),
    description: $("#description").value.trim(),
    duration: Number($("#duration").value),
    deadline: $("#deadline").value || null,
    priority: $("#priority").value,
    category: $("#category").value,
    createdAt: new Date().toISOString(),
    completed: false,
  };
  if (!task.title) return;

  const analysis = analyzeTask(task);
  Object.assign(task, {
    difficulty: analysis.difficulty,
    points: analysis.points,
    breakdown: analysis.breakdown,
    awardedPoints: 0,
  });

  state.tasks.unshift(task);
  showAnalysis(analysis, task);
  taskForm.reset();
  $("#duration").value = 1;
  render();
});

function showAnalysis(analysis, task) {
  analysisPreview.classList.remove("hidden");
  analysisPreview.innerHTML = `
    <strong>Dificultad asignada: ${analysis.difficulty}/10</strong> · Recompensa base: ${analysis.points} pts<br>
    <span class="breakdown">${analysis.breakdown
      .map((b) => `${b.label}: ${b.score.toFixed(1)}/${b.max}`)
      .join(" · ")}</span>
  `;
  clearTimeout(showAnalysis._t);
  showAnalysis._t = setTimeout(() => analysisPreview.classList.add("hidden"), 8000);
}

function completeTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || task.completed) return;
  task.completed = true;
  task.completedAt = new Date().toISOString();
  const reward = calculateReward(task);
  task.awardedPoints = reward.total;
  state.totalPoints += reward.total;
  render();
  alert(`¡Tarea completada! +${reward.total} puntos\n${reward.bonusLines.join("\n")}`);
}

function deleteTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) return;
  if (task.completed) {
    state.totalPoints = Math.max(0, state.totalPoints - task.awardedPoints);
  }
  state.tasks = state.tasks.filter((t) => t.id !== id);
  render();
}

document.querySelectorAll(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderTasks();
  });
});

render();
