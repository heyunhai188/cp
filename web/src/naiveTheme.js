import { computed } from "vue";
import { activeThemeId } from "./theme.js";

const PALETTES = {
  classic: { primary: "#8d3aad", hover: "#a45cc4", pressed: "#6d248c" },
  "sport-red": { primary: "#c1282e", hover: "#e45736", pressed: "#861a23" },
  "welfare-blue": { primary: "#2862a8", hover: "#4785d6", pressed: "#173d70" },
  emerald: { primary: "#167458", hover: "#39a77c", pressed: "#0d503e" },
  "festive-red": { primary: "#ce2730", hover: "#f04b3e", pressed: "#941b25" },
};

export const naiveThemeOverrides = computed(() => {
  const palette = PALETTES[activeThemeId.value] || PALETTES.classic;
  return {
    common: {
      primaryColor: palette.primary,
      primaryColorHover: palette.hover,
      primaryColorPressed: palette.pressed,
      primaryColorSuppl: palette.hover,
      borderRadius: "10px",
      fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    },
  };
});
