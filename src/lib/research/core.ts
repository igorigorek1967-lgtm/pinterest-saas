export const PROJECTS = ["geo-yeisk", "makerora", "bezsahara", "omnihub"] as const;
export type Project = typeof PROJECTS[number];
export type Metric = "monthly_searches" | "relative_index" | "unmeasured";
export type Observation = {
  keyword: string; topicId: string | null; project: Project; language: "ru" | "en";
  country: string | null; metric: Metric; value: number | null; trendPercent: number | null;
  source: string; sourceUrl: string; observedAt: string;
};
export type ImportContext = Omit<Observation, "keyword" | "topicId" | "value" | "trendPercent">;

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function requiredText(value: unknown, field: string, limit = 300): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`Поле «${field}» не заполнено или слишком длинное.`);
  return value.trim();
}
function numberOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[\s\u00a0\u202f]/g, "").replace(/%$/, "").replace(",", ".");
    if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) throw new Error(`Неверное число в поле «${field}».`);
    value = Number(cleaned);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Неверное число в поле «${field}».`);
  return value;
}
export function validateObservation(raw: unknown): Observation {
  if (!plain(raw)) throw new Error("Каждая запись должна быть объектом.");
  const keyword = requiredText(raw.keyword, "Ключ");
  const project = raw.project as Project;
  if (!PROJECTS.includes(project)) throw new Error("Выберите проект.");
  if (raw.language !== "ru" && raw.language !== "en") throw new Error("Допустимые языки: ru, en.");
  const country = raw.country === null || raw.country === undefined || raw.country === "" ? null : requiredText(raw.country, "Страна", 2).toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) throw new Error("Страна: код из двух букв или пустое поле.");
  const metric = raw.metric as Metric;
  if (!["monthly_searches", "relative_index", "unmeasured"].includes(metric)) throw new Error("Неизвестный тип показателя.");
  const value = numberOrNull(raw.value, "Значение");
  if (value !== null && value < 0) throw new Error("Значение не может быть отрицательным.");
  if (metric === "relative_index" && value !== null && value > 100) throw new Error("Индекс должен быть от 0 до 100.");
  if (metric === "monthly_searches" && value !== null && !Number.isSafeInteger(value)) throw new Error("Месячные поиски: целое число.");
  if (metric === "unmeasured" && value !== null) throw new Error("Для непроверенной идеи число не указывается.");
  const source = requiredText(raw.source, "Источник", 150);
  const sourceUrl = requiredText(raw.sourceUrl, "Ссылка на источник", 1000);
  let url: URL;
  try { url = new URL(sourceUrl); } catch { throw new Error("Нужна полная ссылка на источник."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Источник: HTTPS-ссылка без пароля, параметров и фрагмента.");
  const observedAt = requiredText(raw.observedAt, "Дата", 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString().slice(0, 10) !== observedAt) throw new Error("Нужна существующая дата в формате ГГГГ-ММ-ДД.");
  if (observedAt > new Date().toISOString().slice(0, 10)) throw new Error("Дата наблюдения не может быть в будущем.");
  return { keyword, topicId: raw.topicId === null || raw.topicId === undefined || raw.topicId === "" ? null : requiredText(raw.topicId, "ID темы", 100), project, language: raw.language, country, metric, value, trendPercent: numberOrNull(raw.trendPercent, "Изменение"), source, sourceUrl, observedAt };
}

export function parseCsv(text: string): Record<string, string>[] {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
  const separator = firstLine.includes(";") ? ";" : ",";
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  const value = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"') {
      if (quoted && value[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell === "") quoted = !quoted;
      else throw new Error("Некорректные кавычки CSV.");
    } else if (c === separator && !quoted) { row.push(cell); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && value[i + 1] === "\n") i++;
      row.push(cell); if (row.some(v => v.trim())) rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("Незакрытая кавычка CSV.");
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  const headers = rows.shift()?.map(v => v.trim()) ?? [];
  if (new Set(headers).size !== headers.length || headers.some(v => !v)) throw new Error("Заголовки CSV должны быть непустыми и уникальными.");
  return rows.map((r, i) => { if (r.length !== headers.length) throw new Error(`Строка ${i + 2}: число столбцов не совпадает.`); return Object.fromEntries(headers.map((h, n) => [h, r[n]])); });
}

export function parseImport(text: string, context: ImportContext): Observation[] {
  if (text.length > 2_000_000) throw new Error("Файл слишком большой. Максимум 2 МБ текста.");
  const clean = text.trim().replace(/^\uFEFF/, "");
  let rows: unknown;
  if (clean.startsWith("[") || clean.startsWith("{")) {
    const parsed = JSON.parse(clean);
    rows = plain(parsed) ? parsed.observations : parsed;
  } else rows = parseCsv(clean);
  if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new Error("Нужен массив от 1 до 5000 записей.");
  return rows.map((row, index) => {
    try {
      if (!plain(row)) throw new Error("Ожидался объект.");
      return validateObservation({ ...context, ...row, keyword: row.keyword ?? row["Ключ"], value: row.value ?? row["Объём"] ?? null, topicId: row.topicId ?? null, trendPercent: row.trendPercent ?? row["Тенденция"] ?? null });
    } catch (error) { throw new Error(`Запись ${index + 1}: ${(error as Error).message}`); }
  });
}
export function observationId(row: Observation): string {
  return JSON.stringify([row.project, row.language, row.country, row.source, row.sourceUrl, row.keyword.normalize("NFKC").trim().toLocaleLowerCase(), row.topicId, row.metric, row.observedAt]);
}
export function mergeObservations(existing: Observation[], incoming: Observation[]) {
  const map = new Map(existing.map(row => [observationId(row), row]));
  let duplicates = 0;
  for (const row of incoming) {
    const old = map.get(observationId(row));
    if (old) {
      if (old.value !== row.value || old.trendPercent !== row.trendPercent) throw new Error(`Конфликт значений: «${row.keyword}», ${row.observedAt}. Уточните дату или источник.`);
      duplicates++;
    } else map.set(observationId(row), row);
  }
  return { rows: [...map.values()], added: map.size - existing.length, duplicates };
}
export function cluster(keyword: string, project: Project): string {
  const text = keyword.toLocaleLowerCase();
  if (project === "geo-yeisk") {
    if (/квартир|жиль|аренд|снять|гостев|апартамент|rent|apartment/.test(text)) return "Подбор жилья";
    if (/дет|семь|family|child/.test(text)) return "Семейный отдых";
    if (/кайт|серф|сёрф|kite|surf/.test(text)) return "Кайт и активный отдых";
    if (/пляж|мор[ея]|beach|sea/.test(text)) return "Море и пляжи";
    return "Другие темы Ейска";
  }
  if (project === "makerora") return /christmas|рождеств|новогод/.test(text) ? "Сезонные проекты" : "Творчество и материалы";
  if (project === "bezsahara") return /рецепт|recipe|завтрак|breakfast/.test(text) ? "Рецепты и питание" : "Личный опыт";
  return "Инструменты и работа";
}
export function isYeiskQuery(keyword: string): boolean {
  // A substring match accepts «корейский». Match the city and its inflections as whole words.
  return /(^|[^\p{L}\p{N}])(?:ейск(?:а|е|у|ом|ий|ого|ому|им|ая|ой|ую|ое|ие|их|ими)?|yeisk|yeysk|eisk)(?=$|[^\p{L}\p{N}])/iu.test(keyword);
}
export type ProxyState = { status: "unknown" | "working" | "failed"; checkedAt: string | null; expiresOn: string | null };
export function proxyReadiness(proxy: ProxyState, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  if (proxy.expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(proxy.expiresOn) || !Number.isFinite(Date.parse(proxy.expiresOn)) || new Date(proxy.expiresOn).toISOString().slice(0, 10) !== proxy.expiresOn)) return { state: "unknown", message: "Уточните дату окончания у поставщика." };
  if (proxy.expiresOn && proxy.expiresOn < today) return { state: "blocked", message: "Срок прокси истёк. Новый парсинг требует рабочего прокси." };
  if (proxy.status === "failed") return { state: "blocked", message: "Последняя проверка не прошла. Сохранённые данные доступны." };
  if (proxy.status !== "working" || !proxy.checkedAt || !Number.isFinite(Date.parse(proxy.checkedAt)) || Date.parse(proxy.checkedAt) > now.getTime() || now.getTime() - Date.parse(proxy.checkedAt) > 86_400_000) return { state: "unknown", message: "Нет свежей проверки прокси. Это не означает, что он работает." };
  if (!proxy.expiresOn) return { state: "warning", message: "Последняя проверка успешна. Дата окончания неизвестна." };
  const days = Math.round((Date.parse(proxy.expiresOn) - Date.parse(today)) / 86_400_000);
  if (days <= 3) return { state: "warning", message: `До окончания: ${days} дн. Продлите текущий прокси.` };
  return { state: "ready", message: "Проверка свежая, до окончания больше трёх дней." };
}
export function makeBrief(row: Observation) {
  return {
    schema: "omnihub.research-brief.v1", status: "OWNER_REVIEW", project: row.project, language: row.language,
    title: row.keyword, cluster: cluster(row.keyword, row.project), evidence: row,
    instructions: { article: true, pinterest: { width: 1000, height: 1500 }, externalPublication: false },
    delivery: "NOT_SENT", idempotencyKey: observationId(row),
  };
}
