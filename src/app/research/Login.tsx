"use client";
import { useState } from "react";
import "./research.css";
export default function Login({configured}:{configured:boolean}) {
  const [password,setPassword]=useState("");const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  return <main className="research-app login-page"><section className="login-card"><span className="eyebrow">PINTEREST · ИССЛЕДОВАНИЯ</span><h1>Ваша рабочая область</h1><p>Запросы, источники и задания на контент для ваших проектов.</p>{configured?<form onSubmit={async event=>{event.preventDefault();setBusy(true);setError("");try{const response=await fetch('/api/research/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const data=await response.json();if(!response.ok)throw new Error(data.error);window.location.reload();}catch(e){setError((e as Error).message);setBusy(false);}}}><label>Пароль владельца<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={1024}/></label>{error&&<div className="notice error" role="alert">{error}</div>}<button className="primary-button" disabled={busy}>{busy?'Входим…':'Войти'}</button></form>:<div className="notice warning">Рабочая область подготовлена. Администратору осталось настроить вход владельца в окружении сервера.</div>}</section></main>;
}
