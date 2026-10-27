"use client";

import "../styles/legal.css";
import "../styles/contacto.css";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { api } from "@/lib/api";
export default function ContactPage() {
  const [name,setName]=useState(""); const [email,setEmail]=useState(""); const [subject,setSubject]=useState("Consulta sobre MaestrIA"); const [message,setMessage]=useState(""); const [website,setWebsite]=useState(""); const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [sent,setSent]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError("");setSent(false);try{await api("/contact/",{method:"POST",body:JSON.stringify({name,email,subject,message,website})});setSent(true);setName("");setEmail("");setMessage("");setWebsite("");}catch(e){setError(e instanceof Error?e.message:"No se pudo enviar el mensaje. Probá nuevamente más tarde.");}finally{setBusy(false)}}
  return <main className="legal-page contact-page"><article className="legal-content" id="main-content" tabIndex={-1}><span className="eyebrow">HABLEMOS</span><h1>Contacto y soporte</h1><p>¿Tenés una pregunta, una sugerencia o querés participar de una prueba con docentes? Contanos. No incluyas contraseñas, tokens, claves API, datos de estudiantes ni URLs de bases de datos en el mensaje.</p>
    {sent&&<p className="success-message" role="status">Mensaje recibido. Gracias por ayudarnos a mejorar MaestrIA.</p>}{error&&<p className="error-message" role="alert">{error}</p>}
    <form className="form-card" onSubmit={submit}><label htmlFor="contact-name">Nombre <span>*</span></label><input id="contact-name" value={name} onChange={e=>setName(e.target.value)} maxLength={120} autoComplete="name" required/><label htmlFor="contact-email">Correo electrónico <span>*</span></label><input id="contact-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} maxLength={254} autoComplete="email" required/><label htmlFor="contact-subject">Asunto <span>*</span></label><input id="contact-subject" value={subject} onChange={e=>setSubject(e.target.value)} maxLength={160} required/><label htmlFor="contact-message">Mensaje <span>*</span></label><textarea id="contact-message" value={message} onChange={e=>setMessage(e.target.value)} minLength={10} maxLength={4000} rows={6} required placeholder="Contanos cómo podemos ayudarte…"/><div className="honeypot" aria-hidden="true"><label htmlFor="contact-website">No completar</label><input id="contact-website" tabIndex={-1} autoComplete="off" value={website} onChange={e=>setWebsite(e.target.value)}/></div><p className="muted tiny">Usaremos tus datos para responder esta consulta. Evitá incluir información sensible. Ver <Link href="/privacidad">política de privacidad</Link>.</p><button className="button button-primary" disabled={busy}>{busy?"Enviando…":"Enviar consulta"}</button></form>
    <p className="legal-links"><Link href="/sobre-nosotros">Sobre MaestrIA</Link> · <Link href="/privacidad">Privacidad</Link> · <Link href="/terminos">Términos</Link></p></article></main>;
}
