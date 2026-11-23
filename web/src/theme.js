import { ref } from "vue";

export const activeThemeId = ref("light");

export function applyTheme() {
  activeThemeId.value = "light";
  document.documentElement.dataset.theme = "light";
  return "light";
}
