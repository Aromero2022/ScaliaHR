// D40 — applies a stored theme choice before the first paint. The root layout
// puts this in <head> with the request's CSP nonce (D29). It reads two keys,
// accepts only the listed values and sets two attributes; with nothing stored
// it changes nothing, and CSS media queries resolve "system" and "auto".
import { CONTRAST_MODES, THEME_MODES } from "./tokens";

export const THEME_STORAGE_KEY = "scalia.theme";
export const CONTRAST_STORAGE_KEY = "scalia.contrast";

export const THEME_BOOT_SCRIPT = [
  "(function(){try{",
  "var d=document.documentElement,s=window.localStorage;",
  `var t=s.getItem(${JSON.stringify(THEME_STORAGE_KEY)}),c=s.getItem(${JSON.stringify(CONTRAST_STORAGE_KEY)});`,
  `if(${JSON.stringify(THEME_MODES)}.indexOf(t)>-1)d.setAttribute("data-theme",t);`,
  `if(${JSON.stringify(CONTRAST_MODES)}.indexOf(c)>-1)d.setAttribute("data-contrast",c);`,
  "}catch(e){}})();",
].join("");
