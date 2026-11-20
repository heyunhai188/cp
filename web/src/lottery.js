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

// 预测窗口单独保存。首页统计选「全部」时，不会把预测改成跟着库里的期数一起变长。
export function predictRange(code = currentLottery()) {
  return clampN(localStorage.getItem(`predict.range.${code}`) || "100");
}
