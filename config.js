const API_URL = "https://script.google.com/macros/s/AKfycbzJZLvQqJKNBU-b96BWgwoJpoz4HrP8T_0ScwbfIpyPJ5P5OI6rqzx8vb1olnYz2oZsMg/exec";
const ADMIN_NAME = "RAMON";

const CIMA_CONFIG = {
  debounceMs: 350,
  minChars: 3,
  maxSuggestions: 8,
  // Ajusta estos endpoints según la documentación vigente de CIMA/AEMPS y la política CORS.
  searchUrl: "https://cima.aemps.es/cima/rest/medicamentos",
  supplyUrl: "https://cima.aemps.es/cima/rest/psuministro",
};

window.APP_CONFIG = Object.freeze({
  API_URL,
  ADMIN_NAME,
  CIMA_CONFIG,
});
