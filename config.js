const API_URL = "https://script.google.com/macros/s/AKfycbzAlOG7qVWiqAV4NhNbSKpFjnqN4bcLVNeKOg6hhleZ4ekhzN8ldS-jF7uDYLY6ARenXg/exec";
const ADMIN_NAME = "RAMON";

const CIMA_CONFIG = {
  debounceMs: 350,
  minChars: 3,
  maxSuggestions: 8,
  // Ajusta estos endpoints según la documentación vigente de CIMA/AEMPS y la política CORS.
  searchUrl: "https://cima.aemps.es/cima/rest/medicamentos",
  supplyUrl: "https://cima.aemps.es/cima/rest/psuministro",
};
