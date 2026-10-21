// Server/CLI only. Never import this module into a client component.
export const ENDPOINT = 'https://api.pinmetrica.com/pinterest-api/mcp';
export const READ_TOOLS = ['search_keywords', 'suggest_keywords', 'get_categories', 'get_theme'];

export function decodeRpc(body, contentType, id) {
  let messages;
  if (contentType.includes('text/event-stream')) {
    messages = body.split(/\r?\n\r?\n/).filter(Boolean).map(event => event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')).filter(Boolean).map(text => JSON.parse(text));
  } else messages = [JSON.parse(body)];
  const result = messages.find(message => message?.id === id);
  if (!result || result.jsonrpc !== '2.0') throw new Error('Некорректный ответ MCP.');
  if (result.error) throw new Error('MCP сообщил об ошибке запроса.');
  return result.result;
}

export class PinmetricaClient {
  #key; #fetch; #session; #id = 0; #initialized = false;
  constructor(apiKey, fetcher = fetch) {
    if (typeof apiKey !== 'string' || !/^pm_[A-Za-z0-9_-]+$/.test(apiKey)) throw new Error('Нужен PINMETRICA_API_KEY из защищённого окружения.');
    this.#key = apiKey; this.#fetch = fetcher;
  }
  async #request(method, params, notification = false) {
    const id = notification ? undefined : ++this.#id;
    const headers = { Authorization: `Bearer ${this.#key}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
    if (this.#session) headers['Mcp-Session-Id'] = this.#session;
    let response;
    try {
      response = await this.#fetch(ENDPOINT, { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(20_000), body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : {id}), method, ...(params === undefined ? {} : {params}) }) });
    } catch { throw new Error('Не удалось связаться с Pinmetrica MCP.'); }
    if (!response.ok) throw new Error(`Pinmetrica MCP: HTTP ${response.status}.`);
    const session = response.headers.get('Mcp-Session-Id');
    if (session) this.#session = session;
    if (notification) { await response.body?.cancel(); return; }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Пустой ответ MCP.');
    const contentType = response.headers.get('Content-Type') || '';
    const decoder = new TextDecoder(); let buffer = '', length = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 2_000_000) throw new Error('Ответ MCP превышает 2 МБ.');
        buffer += decoder.decode(value, {stream:true});
        if (contentType.includes('text/event-stream')) {
          let boundary;
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const event = buffer.slice(0,boundary.index);
            buffer = buffer.slice(boundary.index+boundary[0].length);
            const data = event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            const message = JSON.parse(data);
            if (message?.id === id) return decodeRpc(JSON.stringify(message),'application/json',id);
          }
        }
      }
      buffer += decoder.decode();
      return decodeRpc(buffer, contentType, id);
    } finally { await reader.cancel().catch(()=>{}); }
  }

  async initialize() {
    const result = await this.#request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pinterest-research-workbench', version: '0.1.0' } });
    if (result?.protocolVersion !== '2024-11-05') throw new Error('Версия протокола требует отдельной проверки.');
    await this.#request('notifications/initialized', undefined, true);
    this.#initialized = true; return result;
  }
  async listTools() {
    if (!this.#initialized) await this.initialize();
    const result = await this.#request('tools/list', {});
    if (!Array.isArray(result?.tools) || result.nextCursor) throw new Error('Каталог MCP изменился. Требуется проверка.');
    return result.tools;
  }
  async call(name, args) {
    if (!READ_TOOLS.includes(name)) throw new Error('Этот инструмент не разрешён для чтения.');
    if (!this.#initialized) await this.initialize();
    const result = await this.#request('tools/call', { name, arguments: args });
    if (result?.isError || !Array.isArray(result?.content)) throw new Error('Не удалось получить результат инструмента.');
    return result;
  }
}

export function parseSearchResult(result) {
  const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  const lines = text.split(/\r?\n/).filter(line => /^• /.test(line));
  if (!lines.length && !/не найден|нет результат|найдено 0/i.test(text)) throw new Error('Формат ответа поиска изменился. Импорт остановлен.');
  return lines.map(line => {
    const clean = line.replace(/\*\*/g, '');
    const match = clean.match(/^• (.+?) — объём: (—|[0-9][0-9,]*)(?=\s+(?:[📈📉]|\|)).*?ID темы: `(\d+)`/u);
    if (!match || !/^(?:—|0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(match[2])) throw new Error('Не удалось прочитать строку поиска.');
    if (match[2] !== '—' && !Number.isSafeInteger(Number(match[2].replaceAll(',', '')))) throw new Error('Неверная частотность.');
    const trend = clean.match(/[📈📉]?\s([+-]\d+(?:\.\d+)?)%/u);
    return { keyword: match[1], topicId: match[3], value: match[2] === '—' ? null : Number(match[2].replaceAll(',', '')), trendPercent: trend ? Number(trend[1]) : null };
  });
}
