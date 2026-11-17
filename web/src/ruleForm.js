function blankPosition() {
  return { parity: "", size: "", prime: "", road: "", digits: [] };
}

function textNumber(value) {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
}

export function createForm(lottery, rule) {
  const form = {
    name: rule?.name || "",
    positions: lottery.positions.map(() => blankPosition()),
    sumMin: "",
    sumMax: "",
    sumParity: "",
    sumSize: "",
    spanMin: "",
    spanMax: "",
    spanParity: "",
    shape: "",
    oddCount: "",
    bigCount: "",
    contains: [],
    excludes: [],
    consecutive: "",
  };
  const definition = rule?.definition;
  if (!definition) return form;
  (definition.positions || []).forEach((position, index) => {
    const target = form.positions[index];
    if (!target || !position) return;
    if (position.parity) target.parity = position.parity;
    if (position.size) target.size = position.size;
    if (position.prime) target.prime = position.prime;
    if (position.road !== undefined && position.road !== null) target.road = String(position.road);
    target.digits = (position.digits || []).map((digit) => String(digit));
  });
  if (definition.sum) {
    if (definition.sum.min !== undefined) form.sumMin = String(definition.sum.min);
    if (definition.sum.max !== undefined) form.sumMax = String(definition.sum.max);
    if (definition.sum.parity) form.sumParity = definition.sum.parity;
    if (definition.sum.size) form.sumSize = definition.sum.size;
  }
  if (definition.span) {
    if (definition.span.min !== undefined) form.spanMin = String(definition.span.min);
    if (definition.span.max !== undefined) form.spanMax = String(definition.span.max);
    if (definition.span.parity) form.spanParity = definition.span.parity;
  }
  if (definition.shape) form.shape = definition.shape;
  if (definition.oddCount !== undefined) form.oddCount = String(definition.oddCount);
  if (definition.bigCount !== undefined) form.bigCount = String(definition.bigCount);
  form.contains = (definition.contains || []).map((digit) => String(digit));
  form.excludes = (definition.excludes || []).map((digit) => String(digit));
  if (definition.consecutive === true) form.consecutive = "yes";
  if (definition.consecutive === false) form.consecutive = "no";
  return form;
}

export function toDefinition(form) {
  const positions = form.positions.map((position) => {
    const item = {};
    if (position.parity) item.parity = position.parity;
    if (position.size) item.size = position.size;
    if (position.prime) item.prime = position.prime;
    if (position.road !== "") item.road = Number(position.road);
    if (position.digits.length) item.digits = position.digits.map(Number);
    return item;
  });
  const definition = { positions };
  const sum = {};
  const sumMin = textNumber(form.sumMin);
  const sumMax = textNumber(form.sumMax);
  if (sumMin !== null) sum.min = sumMin;
  if (sumMax !== null) sum.max = sumMax;
  if (form.sumParity) sum.parity = form.sumParity;
  if (form.sumSize) sum.size = form.sumSize;
  if (Object.keys(sum).length) definition.sum = sum;
  const span = {};
  const spanMin = textNumber(form.spanMin);
  const spanMax = textNumber(form.spanMax);
  if (spanMin !== null) span.min = spanMin;
  if (spanMax !== null) span.max = spanMax;
  if (form.spanParity) span.parity = form.spanParity;
  if (Object.keys(span).length) definition.span = span;
  if (form.shape) definition.shape = form.shape;
  const oddCount = textNumber(form.oddCount);
  const bigCount = textNumber(form.bigCount);
  if (oddCount !== null) definition.oddCount = oddCount;
  if (bigCount !== null) definition.bigCount = bigCount;
  if (form.contains.length) definition.contains = form.contains.map(Number);
  if (form.excludes.length) definition.excludes = form.excludes.map(Number);
  if (form.consecutive === "yes") definition.consecutive = true;
  if (form.consecutive === "no") definition.consecutive = false;
  return definition;
}

export function toggleOne(current, value) {
  return String(current) === String(value) ? "" : String(value);
}

export function toggleMulti(list, value) {
  const key = String(value);
  return list.includes(key) ? list.filter((item) => item !== key) : [...list, key];
}
