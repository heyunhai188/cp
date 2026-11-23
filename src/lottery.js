// 彩种配置。页面和规则都读这里，不要在别处写死「三位」或「百十个」。
// source：cwl 走福彩官网，sporttery 走体彩官网。gameNo 是体彩接口的彩种编号。
// sumBigMin：和值大于等于这个数算「大」。三位是 14（0–13 小），排列五是 23（0–22 小）。
export const LOTTERIES = {
  fc3d: {
    code: "fc3d",
    name: "福彩3D",
    digits: 3,
    positions: ["百位", "十位", "个位"],
    short: ["百", "十", "个"],
    sumMax: 27,
    sumBigMin: 14,
    source: "cwl",
  },
  pl3: {
    code: "pl3",
    name: "排列三",
    digits: 3,
    positions: ["百位", "十位", "个位"],
    short: ["百", "十", "个"],
    sumMax: 27,
    sumBigMin: 14,
    source: "sporttery",
    gameNo: "35",
  },
  pl5: {
    code: "pl5",
    name: "排列五",
    digits: 5,
    positions: ["万位", "千位", "百位", "十位", "个位"],
    short: ["万", "千", "百", "十", "个"],
    sumMax: 45,
    sumBigMin: 23,
    source: "sporttery",
    gameNo: "350133",
  },
  self3d: {
    code: "self3d",
    name: "自开3D",
    digits: 3,
    positions: ["百位", "十位", "个位"],
    short: ["百", "十", "个"],
    sumMax: 27,
    sumBigMin: 14,
    source: "local",
  },
};

export function listLotteries() {
  return Object.values(LOTTERIES);
}

export function listOfficialLotteries() {
  return Object.values(LOTTERIES).filter((lottery) => lottery.source !== "local");
}

export function getLottery(code) {
  const lottery = LOTTERIES[code];
  if (!lottery) {
    const error = new Error("未知彩种");
    error.status = 400;
    throw error;
  }
  return lottery;
}
