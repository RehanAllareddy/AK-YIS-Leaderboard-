export const THEME_STORAGE_KEY = "akyis-theme";

/**
 * Runs before first paint (inlined in <head>) so the page never flashes the
 * wrong theme: a saved choice wins, otherwise follow the OS setting.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
