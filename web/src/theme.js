// 主题选择按登录账号保存在当前设备，不影响其他用户或共享数据。
export const THEMES = [
  { id: "classic", name: "经典紫", note: "当前默认主题", swatch: "linear-gradient(135deg, #a45cc4, #6d248c)" },
  { id: "sport-red", name: "体彩红金", note: "红色主调，金色点缀", swatch: "linear-gradient(135deg, #e45736, #a91f24 58%, #e4b64f)" },
  { id: "welfare-blue", name: "福彩蓝金", note: "清爽蓝色与暖金", swatch: "linear-gradient(135deg, #4785d6, #17447e 58%, #e2b64d)" },
  { id: "emerald", name: "翡翠绿", note: "深绿与明亮金色", swatch: "linear-gradient(135deg, #39a77c, #11634b 58%, #e4bf62)" },
  { id: "festive-red", name: "喜庆中国红", note: "正红与香槟金", swatch: "linear-gradient(135deg, #f04b3e, #bd1725 58%, #f0cf76)" },
];

export function applyTheme(id) {
  const theme = THEMES.some((item) => item.id === id) ? id : "classic";
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function themeStorageKey(userId) {
  return `lottery.theme.user.${userId || "guest"}`;
}
