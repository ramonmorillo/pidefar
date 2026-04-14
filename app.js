const STATUS_OPTIONS = ["Pendiente", "En revisión", "Pedido", "Recibido", "Cancelado", "No necesario"];
const CLOSED_STATES = new Set(["recibido", "cancelado", "no necesario"]);

const state = {
  requests: [],
  filters: {
    estado: "",
    prioridad: "",
    search: "",
    area: "",
    fechaNecesidad: "",
    showHistorical: false,
  },
  cima: {
    debounceTimer: null,
    selected: null,
    requestSeq: 0,
  },
};

const dom = {
  form: document.getElementById("requestForm"),
  createBtn: document.getElementById("createBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  loading: document.getElementById("loadingState"),
  message: document.getElementById("statusMessage"),
  tableBody: document.getElementById("requestsTableBody"),
  emptyState: document.getElementById("emptyState"),
  filterEstado: document.getElementById("filterEstado"),
  filterPrioridad: document.getElementById("filterPrioridad"),
  searchMedicamento: document.getElementById("searchMedicamento"),
  filterArea: document.getElementById("filterArea"),
  filterFechaNecesidad: document.getElementById("filterFechaNecesidad"),
  showHistorical: document.getElementById("showHistorical"),
  medicamentoInput: document.getElementById("medicamentoInput"),
  presentacionInput: document.getElementById("presentacionInput"),
  cimaSuggestions: document.getElementById("cimaSuggestions"),
  cimaLoading: document.getElementById("cimaLoading"),
  cimaSelection: document.getElementById("cimaSelection"),
  supplyFeedback: document.getElementById("supplyFeedback"),
};

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadRequests();
});

function bindEvents() {
  dom.form.addEventListener("submit", handleCreateRequest);
  dom.refreshBtn.addEventListener("click", loadRequests);

  dom.filterEstado.addEventListener("change", (event) => {
    state.filters.estado = event.target.value;
    renderTable();
  });

  dom.filterPrioridad.addEventListener("change", (event) => {
    state.filters.prioridad = event.target.value;
    renderTable();
  });

  dom.searchMedicamento.addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    renderTable();
  });

  dom.filterArea.addEventListener("input", (event) => {
    state.filters.area = event.target.value.trim().toLowerCase();
    renderTable();
  });

  dom.filterFechaNecesidad.addEventListener("change", (event) => {
    state.filters.fechaNecesidad = event.target.value;
    renderTable();
  });

  dom.showHistorical.addEventListener("change", (event) => {
    state.filters.showHistorical = event.target.checked;
    renderTable();
  });

  dom.medicamentoInput.addEventListener("input", onMedicamentoInput);

  dom.medicamentoInput.addEventListener("blur", () => {
    setTimeout(() => hideSuggestions(), 120);
  });
}

async function loadRequests() {
  setLoading(true);
  clearMessage();

  try {
    const response = await fetch(`${API_URL}?action=list`);
    if (!response.ok) throw new Error(`Error HTTP ${response.status}`);

    const data = await response.json();
    const list = normalizeList(data).sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );

    state.requests = list;
    populateEstadoFilter(list);
    renderTable();
  } catch (error) {
    showMessage(`No se pudieron cargar solicitudes. Verifica conexión con Google Apps Script (${error.message}).`, "error");
  } finally {
    setLoading(false);
  }
}

async function handleCreateRequest(event) {
  event.preventDefault();

  if (!dom.form.reportValidity()) return;

  const formData = new FormData(dom.form);
  const payload = Object.fromEntries(formData.entries());
  payload.estado = payload.estado || "Pendiente";

  dom.createBtn.disabled = true;

  try {
    await postToApi({ action: "create", payload });
    dom.form.reset();
    resetCimaSelection();
    showMessage("Solicitud creada correctamente.", "success");
    await loadRequests();
  } catch (error) {
    showMessage(`No se pudo crear la solicitud. ${error.message}`, "error");
  } finally {
    dom.createBtn.disabled = false;
  }
}

async function handleStatusChange(id, estado, selectElement) {
  const previous = selectElement.dataset.previous || "";
  selectElement.disabled = true;

  try {
    await postToApi({
      action: "update_status",
      payload: {
        id,
        estado,
        updated_by: dom.form.elements.created_by.value.trim() || "sistema",
      },
    });

    const target = state.requests.find((item) => String(item.id) === String(id));
    if (target) {
      target.estado = estado;
      target.fecha_cierre = CLOSED_STATES.has((estado || "").toLowerCase()) ? new Date().toISOString() : "";
    }

    selectElement.dataset.previous = estado;
    showMessage(`Estado actualizado a "${estado}".`, "success");
    renderTable();
  } catch (error) {
    selectElement.value = previous;
    showMessage(`No se pudo actualizar estado: ${error.message}`, "error");
  } finally {
    selectElement.disabled = false;
  }
}

function onMedicamentoInput(event) {
  const query = event.target.value.trim();
  state.cima.selected = null;
  renderCimaSelection();
  resetHiddenCimaFields();
  clearTimeout(state.cima.debounceTimer);

  if (query.length < CIMA_CONFIG.minChars) {
    hideSuggestions();
    setCimaLoading(false);
    return;
  }

  state.cima.debounceTimer = setTimeout(async () => {
    await searchCima(query);
  }, CIMA_CONFIG.debounceMs);
}

async function searchCima(query) {
  const requestId = ++state.cima.requestSeq;
  setCimaLoading(true);
  console.log("[CIMA] término buscado:", query);

  try {
    const rawResults = await fetchCimaSearch(query);
    if (requestId !== state.cima.requestSeq) return;
    console.log("[CIMA] resultados recibidos:", rawResults);
    const parsed = processCimaResults(rawResults, query);
    renderCimaSuggestions(parsed, query);
  } catch (error) {
    // Nota: CIMA puede limitar peticiones CORS desde frontend puro según endpoint/entorno.
    // Por diseño la app sigue en modo manual aunque esta integración falle.
    hideSuggestions();
    showMessage(`Búsqueda CIMA no disponible (${error.message}). Puedes continuar en modo manual.`, "error");
  } finally {
    setCimaLoading(false);
  }
}

async function fetchCimaSearch(query) {
  const endpoint = buildCimaSearchUrl(query);
  console.log("[CIMA] URL generada:", endpoint);
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`CIMA HTTP ${response.status}`);
  }

  const data = await response.json();
  return data;
}

function buildCimaSearchUrl(query) {
  const term = String(query || "").trim();
  const url = new URL(CIMA_CONFIG.searchUrl);
  if (term.length >= CIMA_CONFIG.minChars) {
    // CIMA REST usa "nombre" como parámetro de búsqueda principal de medicamentos.
    url.searchParams.set("nombre", term);
  }
  return url.toString();
}

function parseCimaSearchResults(rawResults) {
  const base = Array.isArray(rawResults)
    ? rawResults
    : rawResults?.resultados || rawResults?.result || rawResults?.medicamentos || rawResults?.items || [];

  return base
    .map((item) => {
    const cn = item.cn || item.CN || item.codigo_nacional || item.nregistro || "";
    const nombre = item.nombre || item.nombrecomercial || item.nombre_cima || item.descripcion || "";
    const presentacion = item.presentacion || item.nomPresentacion || item.forma || "";

    return {
      id: `${cn}-${nombre}-${presentacion}`,
      cn: String(cn || ""),
      nombre_cima: String(nombre || "").trim(),
      medicamento_normalizado: String(item.principioActivo || item.medicamento || nombre || "").trim(),
      presentacion_normalizada: String(presentacion || "").trim(),
      label: [nombre, presentacion].filter(Boolean).join(" · "),
    };
    })
    .filter((entry) => entry.label);
}

function dedupeCimaOptions(options) {
  const map = new Map();
  options.forEach((option) => {
    const key = `${option.cn}|${option.label}`.toLowerCase();
    if (!map.has(key)) map.set(key, option);
  });
  return Array.from(map.values());
}

function normalizeSearchText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function processCimaResults(rawResults, query) {
  const normalizedQuery = normalizeSearchText(query);
  const deduped = dedupeCimaOptions(parseCimaSearchResults(rawResults));

  if (!normalizedQuery) return [];

  const startsWith = [];
  const contains = [];

  deduped.forEach((option) => {
    const haystacks = [
      option.nombre_cima,
      option.medicamento_normalizado,
      option.presentacion_normalizada,
      option.label,
    ]
      .map(normalizeSearchText)
      .filter(Boolean);

    const matchesStarts = haystacks.some((value) => value.startsWith(normalizedQuery));
    const matchesContains = haystacks.some((value) => value.includes(normalizedQuery));

    if (matchesStarts) {
      startsWith.push(option);
    } else if (matchesContains) {
      contains.push(option);
    }
  });

  return [...startsWith, ...contains]
    .filter((option) => normalizeSearchText(option.label).includes(normalizedQuery))
    .slice(0, CIMA_CONFIG.maxSuggestions);
}

function renderCimaSuggestions(options, query) {
  // Limpia resultados previos para evitar mezclar sugerencias de búsquedas antiguas.
  dom.cimaSuggestions.innerHTML = "";

  if (!options.length) {
    const normalizedQuery = normalizeSearchText(query);
    if (normalizedQuery.length >= CIMA_CONFIG.minChars) {
      const item = document.createElement("li");
      item.className = "empty";
      item.textContent = "No se encontraron coincidencias";
      dom.cimaSuggestions.appendChild(item);
      dom.cimaSuggestions.classList.remove("hidden");
    } else {
      hideSuggestions();
    }
    return;
  }

  options.forEach((option) => {
    const item = document.createElement("li");
    item.setAttribute("role", "option");
    item.innerHTML = `<div class="primary">${escapeHtml(option.label)}</div><div class="secondary">CN: ${escapeHtml(option.cn || "No disponible")}</div>`;

    item.addEventListener("click", async () => {
      await selectCimaOption(option);
    });

    dom.cimaSuggestions.appendChild(item);
  });

  dom.cimaSuggestions.classList.remove("hidden");
}

function hideSuggestions() {
  dom.cimaSuggestions.classList.add("hidden");
}

async function selectCimaOption(option) {
  state.cima.selected = option;
  dom.medicamentoInput.value = option.nombre_cima || option.medicamento_normalizado;
  dom.presentacionInput.value = option.presentacion_normalizada || "";

  fillHiddenCimaFields(option);
  hideSuggestions();
  renderCimaSelection();

  await loadSupplyInfo(option.cn);
}

function fillHiddenCimaFields(option) {
  setFormValue("medicamento_normalizado", option.medicamento_normalizado || "");
  setFormValue("presentacion_normalizada", option.presentacion_normalizada || "");
  setFormValue("cn", option.cn || "");
  setFormValue("nombre_cima", option.nombre_cima || "");
}

function resetHiddenCimaFields() {
  setFormValue("medicamento_normalizado", "");
  setFormValue("presentacion_normalizada", "");
  setFormValue("cn", "");
  setFormValue("nombre_cima", "");
  setFormValue("tiene_psuministro", "");
  setFormValue("observ_psuministro", "");
}

function setFormValue(fieldName, value) {
  const element = dom.form.elements[fieldName];
  if (element) {
    element.value = value;
  }
}

async function loadSupplyInfo(cn) {
  if (!cn) {
    renderSupplyFeedback(false, "Sin CN. No se pudo comprobar suministro.");
    return;
  }

  try {
    const endpoint = `${CIMA_CONFIG.supplyUrl}?cn=${encodeURIComponent(cn)}`;
    const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`CIMA suministro HTTP ${response.status}`);

    const data = await response.json();
    const hasIssue = Boolean(data?.tiene_psuministro ?? data?.psuministro ?? data?.problema_suministro);
    const note = String(data?.observ_psuministro || data?.observacion || data?.detalle || "").trim();

    setFormValue("tiene_psuministro", hasIssue ? "Sí" : "No");
    setFormValue("observ_psuministro", note);
    renderSupplyFeedback(hasIssue, note);
  } catch (error) {
    setFormValue("tiene_psuministro", "");
    setFormValue("observ_psuministro", "");
    renderSupplyFeedback(false, "No fue posible consultar suministro en CIMA. Continúa en modo manual.");
  }
}

function renderCimaSelection() {
  const selected = state.cima.selected;
  if (!selected) {
    dom.cimaSelection.className = "selection-box hidden";
    dom.cimaSelection.textContent = "";
    return;
  }

  dom.cimaSelection.innerHTML = `<strong>Selección CIMA:</strong> ${escapeHtml(selected.label)} (CN: ${escapeHtml(selected.cn || "No disponible")})`;
  dom.cimaSelection.className = "selection-box";
}

function renderSupplyFeedback(hasIssue, note) {
  dom.supplyFeedback.classList.remove("hidden", "warning", "success");
  dom.supplyFeedback.classList.add(hasIssue ? "warning" : "success");
  const base = hasIssue ? "Problema de suministro detectado." : "Sin problemas de suministro reportados.";
  dom.supplyFeedback.textContent = note ? `${base} ${note}` : base;
}

function resetCimaSelection() {
  state.cima.selected = null;
  hideSuggestions();
  renderCimaSelection();
  dom.supplyFeedback.className = "selection-box hidden";
  dom.supplyFeedback.textContent = "";
  resetHiddenCimaFields();
}

async function postToApi(body) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status}`);
  }

  const result = await response.json().catch(() => ({}));

  if (result.error) {
    throw new Error(result.error);
  }

  return result;
}

function renderTable() {
  const filtered = applyFilters(state.requests);
  dom.tableBody.innerHTML = "";

  if (!filtered.length) {
    dom.emptyState.classList.remove("hidden");
    return;
  }

  dom.emptyState.classList.add("hidden");

  filtered.forEach((item) => {
    const row = document.createElement("tr");
    const supplyInfo = computeSupplyInfo(item);

    row.innerHTML = `
      <td>${formatDate(item.created_at)}</td>
      <td>${formatDate(item.fecha_necesidad, false)}</td>
      <td>${escapeHtml(item.medicamento || item.medicamento_normalizado || "-")}</td>
      <td>${escapeHtml(item.presentacion || item.presentacion_normalizada || "-")}</td>
      <td>${escapeHtml(item.area || "-")}</td>
      <td>${escapeHtml(item.created_by || "-")}</td>
      <td><span class="tag ${priorityClass(item.prioridad)}">${escapeHtml(item.prioridad || "-")}</span></td>
      <td><span class="tag ${stateClass(item.estado)}">${escapeHtml(item.estado || "Pendiente")}</span></td>
      <td>${escapeHtml(item.observaciones || "-")}</td>
      <td><span class="tag ${supplyInfo.css}" title="${escapeHtml(supplyInfo.note || "")}">${escapeHtml(supplyInfo.label)}</span></td>
      <td>
        <select class="status-select" data-id="${escapeHtml(String(item.id || ""))}">
          ${STATUS_OPTIONS.map((status) => `<option value="${status}" ${status === (item.estado || "Pendiente") ? "selected" : ""}>${status}</option>`).join("")}
        </select>
      </td>
    `;

    const selector = row.querySelector(".status-select");
    selector.dataset.previous = item.estado || "Pendiente";
    selector.addEventListener("change", (event) => {
      const selectedStatus = event.target.value;
      handleStatusChange(item.id, selectedStatus, event.target);
    });

    dom.tableBody.appendChild(row);
  });
}

function computeSupplyInfo(item) {
  const raw = String(item.tiene_psuministro || "").toLowerCase();
  const hasIssue = raw === "sí" || raw === "si" || raw === "true" || raw === "1";

  return {
    label: hasIssue ? "Problema suministro" : "Sin incidencia",
    note: item.observ_psuministro || "",
    css: hasIssue ? "supply-warning" : "supply-ok",
  };
}

function applyFilters(requests) {
  return requests.filter((item) => {
    const estadoActual = (item.estado || "").toLowerCase();
    const byEstado = !state.filters.estado || estadoActual === state.filters.estado.toLowerCase();
    const byPrioridad = !state.filters.prioridad || (item.prioridad || "").toLowerCase() === state.filters.prioridad.toLowerCase();
    const bySearch = !state.filters.search || (item.medicamento || item.medicamento_normalizado || "").toLowerCase().includes(state.filters.search);
    const byArea = !state.filters.area || (item.area || "").toLowerCase().includes(state.filters.area);
    const byFechaNecesidad = !state.filters.fechaNecesidad || normalizeDateOnly(item.fecha_necesidad) === state.filters.fechaNecesidad;
    const byHistorical = state.filters.showHistorical || !CLOSED_STATES.has(estadoActual);

    return byEstado && byPrioridad && bySearch && byArea && byFechaNecesidad && byHistorical;
  });
}

function normalizeDateOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function populateEstadoFilter(list) {
  const prevValue = dom.filterEstado.value;
  const estados = new Set(STATUS_OPTIONS);

  list.forEach((item) => {
    if (item.estado) estados.add(item.estado);
  });

  dom.filterEstado.innerHTML = "<option value=''>Todos los estados</option>";
  Array.from(estados)
    .sort((a, b) => a.localeCompare(b, "es"))
    .forEach((estado) => {
      const option = document.createElement("option");
      option.value = estado;
      option.textContent = estado;
      dom.filterEstado.appendChild(option);
    });

  if (Array.from(estados).includes(prevValue)) {
    dom.filterEstado.value = prevValue;
    state.filters.estado = prevValue;
  } else {
    state.filters.estado = "";
  }
}

function normalizeList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw.items)) return raw.items;
  return [];
}

function formatDate(value, withTime = true) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));

  const options = withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" };
  return new Intl.DateTimeFormat("es-ES", options).format(date);
}

function priorityClass(prioridad = "") {
  return `priority-${sanitizeToken(prioridad)}`;
}

function stateClass(status = "") {
  return `state-${sanitizeToken(status)}`;
}

function sanitizeToken(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "none";
}

function setLoading(isLoading) {
  dom.loading.classList.toggle("hidden", !isLoading);
}

function setCimaLoading(isLoading) {
  dom.cimaLoading.classList.toggle("hidden", !isLoading);
}

function showMessage(text, type) {
  dom.message.textContent = text;
  dom.message.className = `status-banner ${type}`;
}

function clearMessage() {
  dom.message.textContent = "";
  dom.message.className = "status-banner";
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
