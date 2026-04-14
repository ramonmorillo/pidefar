const STATUS_OPTIONS = ["Pendiente", "En revisión", "Pedido", "Recibido", "Cancelado"];

const state = {
  requests: [],
  filters: {
    estado: "",
    prioridad: "",
    search: "",
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
    showMessage(`No se pudieron cargar solicitudes: ${error.message}`, "error");
  } finally {
    setLoading(false);
  }
}

async function handleCreateRequest(event) {
  event.preventDefault();

  if (!dom.form.reportValidity()) return;

  const formData = new FormData(dom.form);
  const payload = Object.fromEntries(formData.entries());

  dom.createBtn.disabled = true;

  try {
    await postToApi({ action: "create", payload });
    dom.form.reset();
    showMessage("Solicitud creada correctamente.", "success");
    await loadRequests();
  } catch (error) {
    showMessage(`No se pudo crear la solicitud: ${error.message}`, "error");
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
    if (target) target.estado = estado;

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

    row.innerHTML = `
      <td>${formatDate(item.created_at)}</td>
      <td>${escapeHtml(item.medicamento)}</td>
      <td>${escapeHtml(item.area)}</td>
      <td>${escapeHtml(item.created_by)}</td>
      <td><span class="tag ${priorityClass(item.prioridad)}">${escapeHtml(item.prioridad || "-")}</span></td>
      <td><span class="tag ${stateClass(item.estado)}">${escapeHtml(item.estado || "Pendiente")}</span></td>
      <td>${escapeHtml(item.observaciones || "-")}</td>
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

function applyFilters(requests) {
  return requests.filter((item) => {
    const byEstado = !state.filters.estado || (item.estado || "").toLowerCase() === state.filters.estado.toLowerCase();
    const byPrioridad = !state.filters.prioridad || (item.prioridad || "").toLowerCase() === state.filters.prioridad.toLowerCase();
    const bySearch = !state.filters.search || (item.medicamento || "").toLowerCase().includes(state.filters.search);

    return byEstado && byPrioridad && bySearch;
  });
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

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));

  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
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
