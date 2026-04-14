const STATUS_OPTIONS = ["Pendiente", "En revisión", "Pedido", "Recibido", "Cancelado", "No necesario"];
const SHORTAGE_STATUS_OPTIONS = ["activo", "resuelto"];
const CLOSED_STATES = new Set(["recibido", "cancelado", "no necesario"]);
const AUTO_REFRESH_MS = 60000;
const APP_CONFIG = window.APP_CONFIG || {};
const RESOLVED_ADMIN_NAME = String(APP_CONFIG.ADMIN_NAME || (typeof ADMIN_NAME !== "undefined" ? ADMIN_NAME : "")).trim();
console.log("API_URL:", API_URL);

const state = {
  activeTab: "solicitudes",
  requests: [],
  shortages: [],
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
  user: {
    name: "",
    isAdmin: false,
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
  counterPendiente: document.getElementById("counterPendiente"),
  counterRevision: document.getElementById("counterRevision"),
  counterPedidoReciente: document.getElementById("counterPedidoReciente"),
  tabSolicitudes: document.getElementById("tabSolicitudes"),
  tabShortages: document.getElementById("tabShortages"),
  viewSolicitudes: document.getElementById("viewSolicitudes"),
  viewShortages: document.getElementById("viewShortages"),
  addShortageBtn: document.getElementById("addShortageBtn"),
  shortageForm: document.getElementById("shortageForm"),
  saveShortageBtn: document.getElementById("saveShortageBtn"),
  cancelShortageBtn: document.getElementById("cancelShortageBtn"),
  shortagesTableBody: document.getElementById("shortagesTableBody"),
  shortagesEmptyState: document.getElementById("shortagesEmptyState"),
  shortageMedicamentoInput: document.getElementById("shortageMedicamentoInput"),
};

document.addEventListener("DOMContentLoaded", async () => {
  initializeUserContext();
  bindEvents();
  renderAdminControls();
  await loadAllData();
  setupAutoRefresh();
});

function initializeUserContext() {
  state.user.name = RESOLVED_ADMIN_NAME;
  state.user.isAdmin = normalizeSearchText(state.user.name) === normalizeSearchText(RESOLVED_ADMIN_NAME);
  if (dom.form?.elements?.created_by) {
    dom.form.elements.created_by.value = state.user.name;
  }
}

function bindEvents() {
  dom.form.addEventListener("submit", handleCreateRequest);
  dom.refreshBtn.addEventListener("click", () => loadAllData());
  dom.form.elements.created_by.addEventListener("input", handleIdentityChange);

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

  dom.tabSolicitudes.addEventListener("click", () => setActiveTab("solicitudes"));
  dom.tabShortages.addEventListener("click", () => setActiveTab("shortages"));

  dom.addShortageBtn.addEventListener("click", showShortageForm);
  dom.cancelShortageBtn.addEventListener("click", hideShortageForm);
  dom.shortageForm.addEventListener("submit", handleCreateShortage);
}

async function loadAllData({ silent = false } = {}) {
  await Promise.all([loadRequests({ silent }), loadShortages({ silent })]);
}

function handleIdentityChange(event) {
  state.user.name = event.target.value.trim();
  state.user.isAdmin = normalizeSearchText(state.user.name) === normalizeSearchText(RESOLVED_ADMIN_NAME);
  renderAdminControls();
  renderShortagesTable();
}

function renderAdminControls() {
  const shouldShow = state.user.isAdmin;
  dom.addShortageBtn.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) {
    hideShortageForm();
  }
}

function showShortageForm() {
  if (!state.user.isAdmin) {
    showMessage("Solo el usuario administrador puede crear incidencias de suministro.", "error");
    return;
  }
  dom.shortageForm.classList.remove("hidden");
  dom.shortageMedicamentoInput.value = dom.medicamentoInput.value.trim();
}

function hideShortageForm() {
  dom.shortageForm.classList.add("hidden");
  dom.shortageForm.reset();
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  const isSolicitudes = tabName === "solicitudes";

  dom.tabSolicitudes.classList.toggle("active", isSolicitudes);
  dom.tabShortages.classList.toggle("active", !isSolicitudes);
  dom.viewSolicitudes.classList.toggle("active", isSolicitudes);
  dom.viewShortages.classList.toggle("active", !isSolicitudes);
}

async function loadRequests({ silent = false } = {}) {
  if (!silent) {
    setLoading(true);
    clearMessage();
  }

  try {
    const response = await fetch(`${API_URL}?action=list`);
    if (!response.ok) throw new Error(`Error HTTP ${response.status}`);

    const data = await response.json();
    const list = normalizeList(data).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    state.requests = list;
    populateEstadoFilter(list);
    renderTable();
  } catch (error) {
    if (!silent) {
      showMessage(`No se pudieron cargar solicitudes. Verifica conexión con Google Apps Script (${error.message}).`, "error");
    }
  } finally {
    if (!silent) {
      setLoading(false);
    }
  }
}

async function loadShortages({ silent = false } = {}) {
  try {
    const response = await fetch(`${API_URL}?action=list_shortages`);
    if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
    const data = await response.json();
    state.shortages = normalizeList(data).sort((a, b) => new Date(b.fecha_inicio || 0) - new Date(a.fecha_inicio || 0));
    renderShortagesTable();
    renderTable();
  } catch (error) {
    if (!silent) {
      showMessage(`No se pudieron cargar incidencias de suministro (${error.message}).`, "error");
    }
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
    const created = await postToApi({ action: "create", payload });
    upsertCreatedRequest(payload, created);
    dom.form.reset();
    resetCimaSelection();
    showMessage(`✅ Solicitud creada para "${payload.medicamento || payload.medicamento_normalizado || "medicamento"}".`, "success");
    renderTable();
  } catch (error) {
    showMessage(`No se pudo crear la solicitud. ${error.message}`, "error");
  } finally {
    dom.createBtn.disabled = false;
  }
}

async function handleCreateShortage(event) {
  event.preventDefault();
  console.log("[shortages] handleCreateShortage: entrada");

  if (!state.user.isAdmin) {
    const message = "No autorizado: solo el usuario administrador puede guardar incidencias.";
    console.error("[shortages] handleCreateShortage", message, { user: state.user.name });
    showMessage(message, "error");
    return;
  }

  if (!dom.shortageForm.reportValidity()) return;

  const formData = new FormData(dom.shortageForm);
  const payload = Object.fromEntries(formData.entries());
  payload.created_by = state.user.name || "admin";

  const requiredKeys = ["medicamento", "estado", "fecha_inicio", "fecha_fin_prevista", "observaciones", "origen"];

  dom.saveShortageBtn.disabled = true;
  try {
    const missingKeys = requiredKeys.filter((key) => !(key in payload));
    if (missingKeys.length) {
      throw new Error(`Campos del formulario sin name o fuera del form: ${missingKeys.join(", ")}`);
    }
    console.log("[shortages] handleCreateShortage: payload", payload);
    const created = await postToApi({ action: "create_shortage", payload });
    console.log("[shortages] handleCreateShortage: respuesta backend", created);

    const createdId = created?.id || created?.item?.id || created?.payload?.id || "";

    await loadShortages();
    hideShortageForm();
    showMessage(createdId ? `✅ Incidencia de suministro creada (ID: ${createdId}).` : "✅ Incidencia de suministro creada.", "success");
  } catch (error) {
    console.error("[shortages] handleCreateShortage: error", error);
    showMessage(`No se pudo crear la incidencia de suministro: ${error.message}`, "error");
  } finally {
    dom.saveShortageBtn.disabled = false;
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
      target.updated_at = new Date().toISOString();
      target.fecha_cierre = CLOSED_STATES.has((estado || "").toLowerCase()) ? new Date().toISOString() : "";
    }

    selectElement.dataset.previous = estado;
    showMessage(`✅ Estado actualizado a "${estado}".`, "success");
    renderTable();
  } catch (error) {
    selectElement.value = previous;
    showMessage(`No se pudo actualizar estado: ${error.message}`, "error");
  } finally {
    selectElement.disabled = false;
  }
}

async function handleShortageStatusChange(id, estado, selectElement) {
  const previous = selectElement.dataset.previous || "";
  selectElement.disabled = true;

  try {
    await postToApi({
      action: "update_shortage",
      payload: {
        id,
        estado,
        updated_by: state.user.name || "admin",
      },
    });

    const target = state.shortages.find((item) => String(item.id) === String(id));
    if (target) target.estado = estado;

    selectElement.dataset.previous = estado;
    renderShortagesTable();
    renderTable();
    showMessage(`✅ Incidencia marcada como "${estado}".`, "success");
  } catch (error) {
    selectElement.value = previous;
    showMessage(`No se pudo actualizar incidencia: ${error.message}`, "error");
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

  try {
    const rawResults = await fetchCimaSearch(query);
    if (requestId !== state.cima.requestSeq) return;
    const parsed = processCimaResults(rawResults, query);
    renderCimaSuggestions(parsed, query);
  } catch (error) {
    hideSuggestions();
    showMessage(`Búsqueda CIMA no disponible (${error.message}). Puedes continuar en modo manual.`, "error");
  } finally {
    setCimaLoading(false);
  }
}

async function fetchCimaSearch(query) {
  const endpoint = buildCimaSearchUrl(query);
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
    const haystacks = [option.nombre_cima, option.medicamento_normalizado, option.presentacion_normalizada, option.label]
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
  console.log("[api] postToApi: request", body);
  const requestBody = JSON.stringify(body);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: requestBody,
  });

  const rawText = await response.text();
  let result = {};
  try {
    result = rawText ? JSON.parse(rawText) : {};
  } catch (error) {
    console.error("[api] postToApi: respuesta no JSON", rawText);
    throw new Error("Respuesta no válida del backend (no es JSON)");
  }

  console.log("[api] postToApi: response", { status: response.status, ok: response.ok, result });

  if (!response.ok) {
    throw new Error(result.error || `Error HTTP ${response.status}`);
  }

  if (result.error) {
    throw new Error(result.error);
  }

  return result;
}

function renderTable() {
  const filtered = applyFilters(state.requests);
  updateCounters(state.requests);
  dom.tableBody.innerHTML = "";

  if (!filtered.length) {
    dom.emptyState.classList.remove("hidden");
    return;
  }

  dom.emptyState.classList.add("hidden");

  filtered.forEach((item) => {
    const row = document.createElement("tr");
    const supplyInfo = computeSupplyInfo(item);
    const shortageAlert = getShortageAlert(item);
    const urgency = computeUrgency(item.fecha_necesidad);

    row.innerHTML = `
      <td>${formatDate(item.created_at)}</td>
      <td>
        <div>${formatDate(item.fecha_necesidad, false)}</div>
        <span class="tag ${urgency.css}">${escapeHtml(urgency.label)}</span>
      </td>
      <td>${escapeHtml(item.medicamento || item.medicamento_normalizado || "-")}</td>
      <td>${escapeHtml(item.presentacion || item.presentacion_normalizada || "-")}</td>
      <td>${escapeHtml(item.area || "-")}</td>
      <td>${escapeHtml(item.created_by || "-")}</td>
      <td><span class="tag ${priorityClass(item.prioridad)}">${escapeHtml(item.prioridad || "-")}</span></td>
      <td><span class="tag ${stateClass(item.estado)}">${escapeHtml(item.estado || "Pendiente")}</span></td>
      <td>${escapeHtml(item.observaciones || "-")}</td>
      <td>
        <span class="tag ${supplyInfo.css}" title="${escapeHtml(supplyInfo.note || "")}">${escapeHtml(supplyInfo.label)}</span>
        ${shortageAlert ? `<div class="tag shortage-linked" title="${escapeHtml(shortageAlert.note)}">Problema de suministro</div>` : ""}
      </td>
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

function renderShortagesTable() {
  dom.shortagesTableBody.innerHTML = "";

  if (!state.shortages.length) {
    dom.shortagesEmptyState.classList.remove("hidden");
    return;
  }

  dom.shortagesEmptyState.classList.add("hidden");

  state.shortages.forEach((item) => {
    const row = document.createElement("tr");
    const statusValue = (item.estado || "activo").toLowerCase();
    row.innerHTML = `
      <td>${escapeHtml(item.medicamento || "-")}</td>
      <td><span class="tag shortage-${sanitizeToken(statusValue)}">${escapeHtml(statusValue)}</span></td>
      <td>${formatDate(item.fecha_inicio, false)}</td>
      <td>${formatDate(item.fecha_fin_prevista, false)}</td>
      <td>${escapeHtml(item.observaciones || "-")}</td>
      <td>${escapeHtml(item.origen || "-")}</td>
      <td>
        ${state.user.isAdmin
          ? `<select class="shortage-status-select" data-id="${escapeHtml(String(item.id || ""))}">
              ${SHORTAGE_STATUS_OPTIONS.map(
                (status) => `<option value="${status}" ${status === statusValue ? "selected" : ""}>${status}</option>`
              ).join("")}
            </select>`
          : "-"}
      </td>
    `;

    if (state.user.isAdmin) {
      const selector = row.querySelector(".shortage-status-select");
      selector.dataset.previous = statusValue;
      selector.addEventListener("change", (event) => {
        handleShortageStatusChange(item.id, event.target.value, event.target);
      });
    }

    dom.shortagesTableBody.appendChild(row);
  });
}

function getShortageAlert(item) {
  const medicamento = normalizeSearchText(item.medicamento || item.medicamento_normalizado || "");
  if (!medicamento) return null;

  const activeShortage = state.shortages.find((shortage) => {
    const shortageMed = normalizeSearchText(shortage.medicamento || "");
    const isActive = normalizeSearchText(shortage.estado || "activo") === "activo";
    return isActive && shortageMed && (medicamento.includes(shortageMed) || shortageMed.includes(medicamento));
  });

  if (!activeShortage) return null;
  return { note: activeShortage.observaciones || "Incidencia activa" };
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
    const bySearch =
      !state.filters.search || (item.medicamento || item.medicamento_normalizado || "").toLowerCase().includes(state.filters.search);
    const byArea = !state.filters.area || (item.area || "").toLowerCase().includes(state.filters.area);
    const byFechaNecesidad = !state.filters.fechaNecesidad || normalizeDateOnly(item.fecha_necesidad) === state.filters.fechaNecesidad;
    const byHistorical = state.filters.showHistorical || isVisibleInActiveView(item);

    return byEstado && byPrioridad && bySearch && byArea && byFechaNecesidad && byHistorical;
  });
}

function isVisibleInActiveView(item) {
  const estadoActual = (item.estado || "").toLowerCase();
  if (estadoActual === "recibido" || estadoActual === "cancelado") return false;
  if (estadoActual === "pedido" && !isRecentPedido(item)) return false;
  return !CLOSED_STATES.has(estadoActual) || estadoActual === "pedido";
}

function isRecentPedido(item) {
  const reference = new Date(item.updated_at || item.created_at || item.fecha_creacion || 0).getTime();
  if (!reference) return false;
  return Date.now() - reference <= 24 * 60 * 60 * 1000;
}

function updateCounters(requests) {
  const visible = requests.filter((item) => isVisibleInActiveView(item));
  const pendiente = visible.filter((item) => (item.estado || "").toLowerCase() === "pendiente").length;
  const revision = visible.filter((item) => (item.estado || "").toLowerCase() === "en revisión").length;
  const pedidoReciente = visible.filter((item) => (item.estado || "").toLowerCase() === "pedido" && isRecentPedido(item)).length;

  dom.counterPendiente.textContent = String(pendiente);
  dom.counterRevision.textContent = String(revision);
  dom.counterPedidoReciente.textContent = String(pedidoReciente);
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

function computeUrgency(fechaNecesidad) {
  const date = new Date(fechaNecesidad);
  if (Number.isNaN(date.getTime())) {
    return { label: "Sin fecha válida", css: "urgency-none" };
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  if (days < 0) return { label: "Vencida", css: "urgency-overdue" };
  if (days <= 1) return { label: "Urgente", css: "urgency-critical" };
  if (days <= 3) return { label: "Próxima", css: "urgency-soon" };
  return { label: "Planificable", css: "urgency-ok" };
}

function priorityClass(prioridad = "") {
  return `priority-${sanitizeToken(prioridad)}`;
}

function stateClass(status = "") {
  return `state-${sanitizeToken(status)}`;
}

function sanitizeToken(value = "") {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "none"
  );
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

function upsertCreatedRequest(payload, createdResponse) {
  const fromServer = createdResponse?.data || createdResponse?.item || createdResponse?.payload || {};
  const newItem = {
    ...payload,
    ...fromServer,
    id: fromServer.id || payload.id || `tmp-${Date.now()}`,
    created_at: fromServer.created_at || new Date().toISOString(),
    updated_at: fromServer.updated_at || new Date().toISOString(),
  };

  state.requests.unshift(newItem);
}

function setupAutoRefresh() {
  setInterval(() => {
    if (!document.hidden) {
      loadAllData({ silent: true });
    }
  }, AUTO_REFRESH_MS);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
