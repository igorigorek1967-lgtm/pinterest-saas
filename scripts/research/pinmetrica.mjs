import { PinmetricaClient, parseSearchResult } from './mcp-client.mjs';
import { isYeiskQuery, validateObservation, PROJECTS } from '../../src/lib/research/core.ts';

async function main() {
  const args = process.argv.slice(2);
  const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const query = value('--query');
  const project = value('--project') || 'geo-yeisk';
  if (!PROJECTS.includes(project)) throw new Error('Неизвестный проект.');
  const client = new PinmetricaClient(process.env.PINMETRICA_API_KEY);
  const tools = await client.listTools();
  if (!query) { console.log(JSON.stringify({schema:'pinmetrica.tools.v1',tools},null,2)); return; }
  if (query.trim().length < 2 || query.length > 200) throw new Error('Запрос: от 2 до 200 символов.');
  const tool = tools.find(tool => tool.name === 'search_keywords');
  if (!tool) throw new Error('Поиск не найден в каталоге MCP.');
  const result = await client.call('search_keywords', {q:query, page:1, per_page:20});
  const candidates = parseSearchResult(result);
  const observations = []; const excluded = [];
  for (const row of candidates) {
    if (project === 'geo-yeisk' && !isYeiskQuery(row.keyword)) { excluded.push({keyword:row.keyword,reason:'Название города не найдено отдельным словом. Требуется ручная проверка.'}); continue; }
    observations.push(validateObservation({...row, project, language:value('--language') || 'ru', country:null, metric:'monthly_searches', source:'Pinmetrica MCP · search_keywords', sourceUrl:'https://api.pinmetrica.com/pinterest-api/mcp', observedAt:new Date().toISOString().slice(0,10)}));
  }
  console.log(JSON.stringify({schema:'pinterest-research.v1', query, observations, excluded, coverage:{pagesRead:1,pageSize:20,complete:false,note:'Обработана первая страница. Пустой результат не доказывает отсутствие спроса. Дата — дата получения ответа; дата обновления базы и страна неизвестны.'}},null,2));
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
