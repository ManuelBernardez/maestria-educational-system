import "../styles/terminos.css";
import "../styles/legal.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Términos de uso",
  description: "Condiciones básicas de uso de MaestrIA, herramienta de asistencia docente.",
  alternates: { canonical: "/terminos" },
};

export default function TermsPage() {
  return <main className="legal-page terms-policy-page"><article className="legal-content" id="main-content" tabIndex={-1}><span className="eyebrow">USO RESPONSABLE</span><h1>Términos de uso</h1><p className="legal-updated">Documento base para revisión del operador del servicio.</p><div className="notice" role="note"><strong>Antes de publicar:</strong> estos términos son una plantilla y deben ser revisados por el responsable del sitio para completar entidad, jurisdicción, contacto, condiciones comerciales y obligaciones legales aplicables.</div><h2>Función de la herramienta</h2><p>MaestrIA ayuda a preparar evaluaciones, organizar rúbricas y producir propuestas de retroalimentación. Las propuestas generadas automáticamente pueden contener errores, omisiones o sesgos y no sustituyen el criterio profesional del docente.</p><h2>Responsabilidad del docente</h2><p>El usuario debe revisar las consignas, puntajes, evidencias y devoluciones antes de utilizarlas. No debe tratar salidas del modo demostración como calificaciones, ni enviar propuestas simuladas a estudiantes.</p><h2>Uso permitido</h2><p>El usuario debe tener autorización para cargar y procesar los datos que incorpora, respetar los derechos de estudiantes y terceros, proteger las credenciales y no intentar acceder a información de otras cuentas ni interferir con el servicio.</p><h2>Disponibilidad y proveedores</h2><p>El funcionamiento depende de proveedores externos configurados por el operador. Pueden existir interrupciones, límites de uso o cambios en las condiciones de esos proveedores. No se garantiza disponibilidad continua ni la corrección de una salida automatizada.</p><h2>Cuenta y seguridad</h2><p>Las credenciales son personales. Ante una actividad sospechosa, el usuario debe cambiar la contraseña y avisar al responsable. El operador debe establecer los mecanismos de soporte, cierre de cuenta, retención y respuesta a incidentes antes de habilitar el servicio a terceros.</p><h2>Datos del operador</h2><p>Completar nombre o razón social, domicilio, correo de contacto, jurisdicción aplicable, fecha de entrada en vigor y un procedimiento para comunicar cambios.</p><p className="legal-links"><Link href="/privacidad">Privacidad</Link> · <Link href="/contacto">Contacto</Link> · <Link href="/">Inicio</Link></p></article></main>;
}
