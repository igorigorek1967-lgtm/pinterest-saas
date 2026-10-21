"use client";

import { useEffect, useRef, useState } from "react";
import { cluster, isYeiskQuery, makeBrief, parseImport, PROJECTS, proxyReadiness, type Observation, type Project, type Metric, type ProxyState } from "@/lib/research/core";
import "./research.css";

const labels: Record<Project, string> = { "geo-yeisk": "ГЕО Ейск", makerora: "Makerora", bezsahara: "БезСахара", omnihub: "OmniHub" };
const metrics: Record<Metric, string> = { monthly_searches: "Поиски за месяц", relative_index: "Индекс 0–100", unmeasured: "Без измерения" };
const storageKey = "pinterest-research.v1";
const blankProxy: ProxyState = { status: "unknown", checkedAt: null, expiresOn: null };
type SearchResult = {mode:string;text:string;observations:Observation[];excluded:{keyword:string;reason:string}[];coverage?:{page:number;pageSize:number;complete:boolean}};
async function api(action:string,body?:unknown) {
  const response=await fetch(`/api/research/${action}`,body===undefined?{cache:"no-store"}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok){if(response.status===401)window.location.reload();throw new Error(data.error||"Операция не выполнена.");}return data;
}

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Research() {
  const [project, setProject] = useState<Project>("geo-yeisk");
  const [rows, setRows] = useState<Observation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"keywords" | "briefs" | "connections">("keywords");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [input, setInput] = useState("");
  const [source, setSource] = useState("Pinmetrica · ручной импорт");
  const [sourceUrl, setSourceUrl] = useState("https://app.pinmetrica.com/keywords");
  const [language, setLanguage] = useState<"ru" | "en">("ru");
  const [country, setCountry] = useState("");
  const [metric, setMetric] = useState<Metric>("monthly_searches");
  const [allowRelated, setAllowRelated] = useState(false);
  const [observedAt, setObservedAt] = useState("");
  const [proxy, setProxy] = useState<ProxyState>(blankProxy);
  const [briefs, setBriefs] = useState<ReturnType<typeof makeBrief>[]>([]);
  const [sourceConfigured,setSourceConfigured]=useState(false);
  const [remoteQuery,setRemoteQuery]=useState("");
  const [remoteMode,setRemoteMode]=useState("search");
  const [remotePage,setRemotePage]=useState(1);
  const [remoteResult,setRemoteResult]=useState<SearchResult|null>(null);
  const [busy,setBusy]=useState(false);
  const [legacyAvailable,setLegacyAvailable]=useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refreshState() {const state=await api('state');setRows(state.observations);setBriefs(state.briefs);setProxy(state.proxy);setSourceConfigured(state.sourceConfigured);setLoaded(true);}

  useEffect(() => {
    setObservedAt(new Date().toISOString().slice(0, 10));
    try { setLegacyAvailable(!!localStorage.getItem(storageKey)); } catch { /* Server storage remains available. */ }
    refreshState().catch(e=>setError(e.message));
  }, []);

  const projectRows = rows.filter(row => row.project === project);
  const filtered = projectRows.filter(row => row.keyword.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const groupCount = new Set(projectRows.map(row => cluster(row.keyword, row.project))).size;
  const health = proxyReadiness(proxy);

  async function importRows() {
    setError(""); setMessage("");
    setBusy(true);
    try {
      if (!loaded) throw new Error("Импорт отключён до восстановления сохранённых данных.");
      const incoming = parseImport(input, { project, language, country: country || null, metric, source, sourceUrl, observedAt });
      const unrelated = incoming.filter(row => row.project === "geo-yeisk" && !isYeiskQuery(row.keyword));
      if (unrelated.length && !allowRelated) throw new Error(`Есть запросы без названия города отдельным словом: ${unrelated.slice(0, 3).map(row => row.keyword).join(", ")}. Проверьте их и подтвердите смежные темы вручную.`);
      const merged = await api('import',{observations:incoming,allowRelated});
      await refreshState(); setMessage(`Сохранено на сервере: ${merged.added}. Повторов пропущено: ${merged.duplicates}.`);
      setInput(""); setImportOpen(false);
    } catch (e) { setError((e as Error).message); } finally {setBusy(false);}
  }
  async function createBrief(row: Observation) {
    setError("");try{await api('brief',{observation:row});await refreshState();setMessage(`Задание «${row.keyword}» сохранено. В OmniHub ещё не отправлено.`);}catch(e){setError((e as Error).message);}
  }
  async function runQuery() {
    setBusy(true);setError("");setRemoteResult(null);
    try{setRemoteResult(await api('query',{mode:remoteMode,q:remoteQuery,themeId:remoteQuery,project,language,page:remotePage}));}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }

  return <div className="research-app">
    <aside className="research-sidebar">
      <a className="research-brand" href="/research"><span className="brand-symbol">P</span><span>Pinterest<span className="brand-small">исследования</span></span></a>
      <div className="sidebar-label">ВАШИ ПРОЕКТЫ</div>
      {PROJECTS.map(p => <button key={p} className={`project-button ${p === project ? "selected" : ""}`} onClick={() => { setProject(p); setQuery("");setRemoteResult(null); }}><span className={`project-dot ${p}`}/>{labels[p]}<span className="project-arrow">↗</span></button>)}
      <div className="sidebar-note"><span className="small-pill">Серверная версия</span><p>Свои ключи, понятные источники и задания на контент.</p><small>Наблюдения и задания сохраняются на сервере и доступны после повторного входа.</small></div>
    </aside>
    <main className="research-main">
      <header className="research-topbar"><span>Рабочая область <span className="breadcrumb">/ {labels[project]}</span></span><button className="text-button" onClick={async()=>{await api('logout',{});window.location.reload();}}>Выйти</button></header>
      <section className="research-heading"><div><div className="eyebrow">ОТ ЗАПРОСА К ПОЛЕЗНОМУ МАТЕРИАЛУ</div><h1>Что ищет ваша аудитория?</h1><p>Соберите запросы, проверьте спрос и выберите следующую тему.</p></div><button className="primary-button" disabled={!loaded} onClick={() => setImportOpen(!importOpen)}>＋ Добавить данные</button></section>
      <div className="research-tabs" role="tablist" aria-label="Разделы исследования">{([["keywords", "Ключи и темы"], ["briefs", `Готовые задания · ${briefs.length}`], ["connections", "Данные и подключения"]] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}>{label}</button>)}</div>
      {error && <div className="notice error" role="alert">{error}</div>}{message && <div className="notice success" role="status">{message}</div>}
      {legacyAvailable&&<div className="notice warning">В этом браузере есть данные первой версии. <button className="text-button" onClick={()=>{setInput(localStorage.getItem(storageKey)||'');setImportOpen(true);}}>Открыть для переноса на сервер</button></div>}
      {importOpen && <section className="import-panel"><h2>Добавить наблюдения</h2><p>Вставьте CSV с полями «Ключ;Объём;Тенденция» или JSON. Метаданные ниже применяются к строкам, где они отсутствуют.</p><div className="form-grid">
        <label>Источник<input value={source} onChange={e => setSource(e.target.value)}/></label><label>Ссылка без параметров<input type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)}/></label>
        <label>Показатель<select value={metric} onChange={e => setMetric(e.target.value as Metric)}>{Object.entries(metrics).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Дата наблюдения<input type="date" value={observedAt} onChange={e => setObservedAt(e.target.value)}/></label>
        <label>Язык<select value={language} onChange={e => setLanguage(e.target.value as "ru" | "en")}><option value="ru">Русский</option><option value="en">Английский</option></select></label><label>Страна, если известна<input placeholder="Например, RU. Пусто = неизвестно" value={country} maxLength={2} onChange={e => setCountry(e.target.value.toUpperCase())}/></label>
      </div><label className="related-checkbox"><input type="checkbox" checked={allowRelated} onChange={e => setAllowRelated(e.target.checked)}/>Я проверил смежные темы без отдельного слова «Ейск» и хочу включить их в проект.</label><label className="textarea-label">Данные<textarea rows={6} value={input} onChange={e => setInput(e.target.value)} placeholder={'Ключ;Объём;Тенденция\nВаш запрос;число;изменение'}/></label>
        <input ref={fileRef} type="file" accept=".json,.csv,text/csv,application/json" hidden onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 2_000_000) { setError("Максимальный размер файла — 2 МБ."); return; } setInput(await file.text()); e.target.value = ""; }}/>
        <div className="button-row"><button className="primary-button" disabled={busy} onClick={importRows}>Проверить и добавить</button><button className="secondary-button" onClick={() => fileRef.current?.click()}>Выбрать CSV или JSON</button><button className="text-button" onClick={() => setImportOpen(false)}>Закрыть</button></div>
      </section>}
      {view === "keywords" && <>
        <div className="stat-grid"><article><span>Наблюдения по проекту</span><strong>{projectRows.length}</strong><small>С источником и датой</small></article><article><span>Тематические группы</span><strong>{groupCount}</strong><small>По смыслу запроса</small></article><article><span>Источник Pinmetrica</span><strong className="stat-text">{sourceConfigured?'Настроен':'Не настроен'}</strong><small>{sourceConfigured?'Доступ проверяется при запросе':'Импорт файлов доступен'}</small></article></div>
        <section className="import-panel remote-panel"><h2>Исследовать в Пинметрике</h2><p>Ответ поступит через защищённое подключение сервера. Ключ доступа в браузер не передаётся.</p><div className="form-grid"><label>Режим<select value={remoteMode} onChange={e=>{setRemoteMode(e.target.value);setRemoteResult(null);}}><option value="search">Поиск ключей</option><option value="suggest">Поисковые подсказки</option><option value="categories">Категории</option><option value="theme">Сведения о теме</option></select></label><label>{remoteMode==='theme'?'ID темы':'Запрос'}<input value={remoteQuery} disabled={remoteMode==='categories'} onChange={e=>setRemoteQuery(e.target.value)} placeholder="Например, Ейск"/></label><label>Язык записи<select value={language} onChange={e=>setLanguage(e.target.value as 'ru'|'en')}><option value="ru">Русский</option><option value="en">Английский</option></select></label>{remoteMode==='search'&&<label>Страница<select value={remotePage} onChange={e=>setRemotePage(Number(e.target.value))}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select></label>}</div><button className="primary-button" disabled={!loaded||!sourceConfigured||busy} onClick={runQuery}>{busy?'Получаем ответ…':'Исследовать'}</button>
          {remoteResult&&<div className="remote-results"><p>Подходящих наблюдений: <strong>{remoteResult.observations.length}</strong>. Отложено для проверки: <strong>{remoteResult.excluded.length}</strong>.</p>{remoteResult.coverage&&<p>Обработана страница {remoteResult.coverage.page}. Дата ответа известна; дата обновления базы и страна неизвестны. Отсутствие результатов не означает отсутствие спроса.</p>}{remoteResult.observations.length>0&&<button className="secondary-button" disabled={busy} onClick={async()=>{setBusy(true);try{const result=await api('import',{observations:remoteResult.observations});await refreshState();setMessage(`Сохранено: ${result.added}. Повторов: ${result.duplicates}.`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Сохранить подходящие запросы</button>}<details><summary>Показать исходный ответ и исключённые темы</summary><pre>{remoteResult.text}</pre>{remoteResult.excluded.map((item,i)=><p key={i}>{item.keyword} — {item.reason}</p>)}</details></div>}
        </section>
        <section className="keywords-panel"><div className="panel-top"><div><h2>Ключи и темы <span>{filtered.length}</span></h2><p>Индекс популярности и число поисков показаны отдельно.</p></div><input aria-label="Найти запрос" className="search-input" placeholder="Найти запрос…" value={query} onChange={e => setQuery(e.target.value)}/></div>
          {filtered.length ? <div className="table-scroll"><table><thead><tr><th>Запрос / группа</th><th>Показатель</th><th>Источник / дата</th><th>Действие</th></tr></thead><tbody>{filtered.map(row => <tr key={JSON.stringify(row)}><td><strong>{row.keyword}</strong><small>{cluster(row.keyword, project)} · {row.language.toUpperCase()} · {row.country || "страна неизвестна"}{row.topicId ? ` · ID ${row.topicId}` : ""}</small></td><td><strong>{row.value === null ? "Нет данных" : row.value.toLocaleString("ru-RU")}</strong><small>{metrics[row.metric]}{row.trendPercent !== null ? ` · ${row.trendPercent > 0 ? "+" : ""}${row.trendPercent}%` : ""}</small></td><td><a href={row.sourceUrl} target="_blank" rel="noreferrer">{row.source}</a><small>{row.observedAt}</small></td><td><button className="row-action" onClick={() => createBrief(row)}>В задание ↗</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><div className="empty-icon">⌕</div><h3>{query ? "Совпадений нет" : "Начните с настоящих данных"}</h3><p>{query ? "Измените запрос или выберите другой проект." : "Добавьте результаты исследования из Пинметрики. У каждой записи останутся источник, дата и тип показателя."}</p>{!query && <button className="secondary-button" onClick={() => setImportOpen(true)}>Добавить первый файл</button>}</div>}
          <div className="panel-footer">Пустое значение означает отсутствие данных. Ноль остаётся нулём.<button className="text-button" onClick={() => download("pinterest-research-backup.json", { schema: "pinterest-research.v1", observations: rows, proxy })}>Скачать резервный JSON ↓</button></div>
        </section>
      </>}
      {view === "briefs" && <section className="keywords-panel"><div className="panel-top"><div><h2>Задания на контент</h2><p>Сохранены на сервере. Скачайте JSON для передачи; автоматической отправки пока нет.</p></div>{briefs.length > 0 && <button className="primary-button" onClick={() => download("omnihub-research-briefs.json", briefs)}>Скачать задания ↓</button>}</div>{briefs.length ? briefs.map(brief => <article className="brief-card" key={brief.idempotencyKey}><div><span className="small-pill">На вашу проверку</span><h3>{brief.title}</h3><p>{labels[brief.project]} · {brief.cluster} · {brief.language.toUpperCase()}</p></div><button className="secondary-button" onClick={() => download("omnihub-research-brief.json", brief)}>Скачать JSON</button></article>) : <div className="empty-state"><h3>Выберите тему в таблице ключей</h3><p>Кнопка «В задание» подготовит материал с доказательствами. Содержимое задания можно скачать.</p></div>}</section>}
      {view === "connections" && <div className="connection-grid"><section className="connection-card"><span className="eyebrow">ПРОКСИ ДЛЯ ПАРСИНГА</span><h2>Продление без потери работы</h2><div className={`notice ${health.state === "blocked" ? "error" : "warning"}`}>{health.message}</div><p>Пинметрика требует активный прокси для нового сбора пинов. Просмотр сохранённых наблюдений работает независимо.</p><label>Дата окончания у поставщика<input type="date" value={proxy.expiresOn || ""} onChange={e => setProxy({ ...proxy, expiresOn: e.target.value || null })}/></label><label>Результат внешней проверки<select value={proxy.status} onChange={e => setProxy({ ...proxy, status: e.target.value as ProxyState["status"], checkedAt: null })}><option value="unknown">Не проверено</option><option value="working">Работает</option><option value="failed">Ошибка</option></select></label><label>Когда фактически проверяли<input type="datetime-local" value={proxy.checkedAt?.slice(0,16) || ""} onChange={e => { const value = e.target.value; setProxy({ ...proxy, checkedAt: value ? new Date(value + "Z").toISOString() : null }); }}/></label><button className="primary-button proxy-save" disabled={!loaded||busy} onClick={async()=>{setBusy(true);try{await api('proxy',{proxy});setMessage('Сведения о прокси сохранены на сервере.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Сохранить сведения о прокси</button><small>Время проверки — UTC. Вы вносите сведения вручную. Эта форма не проверяет и не продлевает прокси; пароли сюда не вводятся.</small></section><section className="connection-card"><span className="eyebrow">ИСТОЧНИКИ ДАННЫХ</span><h2>Каждое подключение отдельно</h2><div className="connection-line"><strong>Импорт CSV / JSON</strong><span className="small-pill">Готов</span></div><div className="connection-line"><strong>Pinmetrica MCP</strong><span>{sourceConfigured?'Секрет настроен; доступ проверяется при запросе':'Не подключён на сервере'}</span></div><div className="connection-line"><strong>Pinterest API</strong><span>Права и доступ проверяются отдельно</span></div><div className="connection-line"><strong>Передача в OmniHub</strong><span>Подготовка JSON; отправка не подключена</span></div><p>REA используется для исследования функций. Ему не требуется ваш прокси для анализа уже полученных файлов.</p><a className="text-link" href="https://github.com/morluto/rea" target="_blank" rel="noreferrer">Открыть официальный REA ↗</a></section></div>}
      <footer className="research-footer">Pinterest · собственный рабочий модуль <span>Материалы проходят вашу проверку перед публикацией</span></footer>
    </main>
  </div>;
}
