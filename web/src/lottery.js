import { clampN } from "./format.js";

export const LOTTERIES = [
  { code: "fc3d", name: "福彩3D" },
  { code: "pl3", name: "排列三" },
  { code: "pl5", name: "排列五" },
];

export function currentLottery() {
  return localStorage.getItem("lottery.code") || "fc3d";
}

export function currentRange(code = currentLottery()) {
  return clampN(localStorage.getItem(`range.${code}`) || "100");
}
