/**
 * Google Apps Script (Code.gs) - v1.1 incremental.
 * Mantiene altas/listado/cambio de estado y añade campos de fechas + CIMA.
 *
 * Hoja esperada: primera fila con cabeceras exactas.
 */

const SHEET_NAME = 'solicitudes';
const FINAL_STATES = ['Recibido', 'Cancelado', 'No necesario'];

function doGet(e) {
  const action = (e.parameter.action || '').toLowerCase();

  if (action === 'list') {
    return jsonResponse({ data: listRequests_() });
  }

  return jsonResponse({ error: 'Acción GET no soportada' });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = (body.action || '').toLowerCase();

    if (action === 'create') {
      const created = createRequest_(body.payload || {});
      return jsonResponse({ ok: true, item: created });
    }

    if (action === 'update_status') {
      const updated = updateStatus_(body.payload || {});
      return jsonResponse({ ok: true, item: updated });
    }

    return jsonResponse({ error: 'Acción POST no soportada' });
  } catch (error) {
    return jsonResponse({ error: error.message || String(error) });
  }
}

function listRequests_() {
  const { sheet, headers } = getSheetWithHeaders_();
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  return values.slice(1).map((row) => {
    const item = {};
    headers.forEach((h, idx) => {
      item[h] = row[idx];
    });
    return item;
  });
}

function createRequest_(payload) {
  const { sheet, headers, map } = getSheetWithHeaders_();

  const now = new Date();
  const row = new Array(headers.length).fill('');

  setByHeader_(row, map, 'id', payload.id || Utilities.getUuid());
  setByHeader_(row, map, 'created_at', now.toISOString());
  setByHeader_(row, map, 'fecha_necesidad', payload.fecha_necesidad || '');
  setByHeader_(row, map, 'fecha_cierre', '');

  setByHeader_(row, map, 'created_by', payload.created_by || '');
  setByHeader_(row, map, 'area', payload.area || '');
  setByHeader_(row, map, 'medicamento', payload.medicamento || '');
  setByHeader_(row, map, 'presentacion', payload.presentacion || '');
  setByHeader_(row, map, 'cantidad', payload.cantidad || '');
  setByHeader_(row, map, 'prioridad', payload.prioridad || '');
  setByHeader_(row, map, 'motivo', payload.motivo || '');
  setByHeader_(row, map, 'observaciones', payload.observaciones || '');

  setByHeader_(row, map, 'estado', payload.estado || 'Pendiente');

  setByHeader_(row, map, 'medicamento_normalizado', payload.medicamento_normalizado || '');
  setByHeader_(row, map, 'presentacion_normalizada', payload.presentacion_normalizada || '');
  setByHeader_(row, map, 'cn', payload.cn || '');
  setByHeader_(row, map, 'nombre_cima', payload.nombre_cima || '');
  setByHeader_(row, map, 'tiene_psuministro', payload.tiene_psuministro || '');
  setByHeader_(row, map, 'observ_psuministro', payload.observ_psuministro || '');

  sheet.appendRow(row);

  const out = {};
  headers.forEach((h, i) => (out[h] = row[i]));
  return out;
}

function updateStatus_(payload) {
  const { sheet, headers, map } = getSheetWithHeaders_();
  const id = String(payload.id || '');
  const newStatus = payload.estado || 'Pendiente';

  if (!id) throw new Error('Falta payload.id');

  const idCol = getRequiredIndex_(map, 'id') + 1;
  const data = sheet.getDataRange().getValues();

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol - 1]) === id) {
      const rowNumber = r + 1;
      if (map.estado !== undefined) {
        sheet.getRange(rowNumber, map.estado + 1).setValue(newStatus);
      }

      if (map.fecha_cierre !== undefined) {
        const cierre = FINAL_STATES.indexOf(newStatus) >= 0 ? new Date().toISOString() : '';
        sheet.getRange(rowNumber, map.fecha_cierre + 1).setValue(cierre);
      }

      const updated = {};
      const refreshed = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
      headers.forEach((h, i) => (updated[h] = refreshed[i]));
      return updated;
    }
  }

  throw new Error('No se encontró solicitud para ese id');
}

function getSheetWithHeaders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`No existe hoja: ${SHEET_NAME}`);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
  const map = {};
  headers.forEach((h, idx) => {
    map[h] = idx;
  });

  return { sheet, headers, map };
}

function getRequiredIndex_(map, header) {
  if (map[header] === undefined) {
    throw new Error(`Falta columna requerida: ${header}`);
  }
  return map[header];
}

function setByHeader_(row, map, header, value) {
  if (map[header] !== undefined) {
    row[map[header]] = value;
  }
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
