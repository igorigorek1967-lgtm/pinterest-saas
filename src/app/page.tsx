import Link from "next/link";

export default function Home() {
  return (
    <main style={{padding:48,fontFamily:"Arial, sans-serif",maxWidth:800,margin:"0 auto"}}>
      <p style={{color:"#527c67"}}>PINTEREST · ИССЛЕДОВАНИЯ</p>
      <h1 style={{fontSize:40,margin:"20px 0"}}>От поискового запроса к полезному материалу</h1>
      <p style={{lineHeight:1.8,marginBottom:30}}>Собственные ключи, источники данных, контроль прокси и задания на контент для ваших проектов.</p>
      <Link href="/research" style={{display:"inline-block",background:"#1d6655",color:"white",padding:"14px 24px",borderRadius:8}}>Открыть рабочую область →</Link>
    </main>
  );
}
