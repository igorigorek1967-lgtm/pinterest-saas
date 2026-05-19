// supabaseClient.js

import { createClient } from '@supabase/supabase-js'

// Твои ключи Supabase
const SUPABASE_URL = 'https://wnylgqqyhtcpcdhyenec.supabase.co' // URL проекта
const SUPABASE_ANON_KEY = 'sb_publishable_7MzkTUjbj...'

// Секретный ключ использовать только локально, не коммитить!
// const SUPABASE_SECRET_KEY = 'sb_secret_1FHye8H44KD2oEsS91mghQ_qP6WQNI'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Пример функции для получения данных из таблицы "posts"
export async function getPosts() {
  const { data, error } = await supabase
    .from('posts') // название таблицы
    .select('*')    // выбрать все поля

  if (error) {
    console.error('Ошибка при получении данных:', error)
    return []
  }

  return data
}
