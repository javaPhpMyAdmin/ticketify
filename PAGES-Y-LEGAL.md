# Guía — GitHub Pages + textos legales

Te lo divido en 3 partes: (A) habilitar Pages, (B) qué hay hoy y qué hacer con el texto, (C) mecánica para regenerar cuando cambies el copy.

---

## A) Habilitar GitHub Pages (5 min, lo hacés vos)

1. Andá a **github.com/javaPhpMyAdmin/ticketify** → pestaña **Settings** → **Pages** (en el menú izquierdo).
2. En **Source**: elegí **"Deploy from a branch"**.
3. En **Branch**: elegí **`main`** y folder **`/docs`** → **Save**.
4. Esperá ~1-2 min. Te aparece arriba del settings: **"Your site is live at https://javaPhpMyAdmin.github.io/ticketify/"**.

Una vez activo, las 6 URLs quedan servidas automáticamente (Jekyll renderiza cada `.md` a HTML):

```
https://javaPhpMyAdmin.github.io/ticketify/legal/es-AR/privacy/
https://javaPhpMyAdmin.github.io/ticketify/legal/es-AR/terms/
https://javaPhpMyAdmin.github.io/ticketify/legal/en/privacy/
https://javaPhpMyAdmin.github.io/ticketify/legal/en/terms/
https://javaPhpMyAdmin.github.io/ticketify/legal/pt-BR/privacy/
https://javaPhpMyAdmin.github.io/ticketify/legal/pt-BR/terms/
```

### Verificación (avisame y la corro yo)

Decime "Pages activo" y yo corro:

```bash
for u in es-AR en pt-BR; do for d in privacy terms; do
  echo -n "$u/$d: "; curl -sS -o /dev/null -w "%{http_code}\n" \
    "https://javaPhpMyAdmin.github.io/ticketify/legal/$u/$d/"; done; done
```

Tiene que dar **200** en las 6. Si alguna da **404**: revisá que el folder en GitHub Pages settings sea **`/docs`** (no `/` ni `/root`) — suele ser el único punto de falla.

---

## B) El contenido — qué hay hoy y qué hacer

Hoy hay **texto DRAFT** en el repo, marcado como BORRADOR en cada archivo. Lo armé como punto de partida; **no es copy legal aprobado**. Lo que te recomiendo:

### Opción 1 (rápida, sin abogado): usar el draft tal cual
- Está redactado para cubrir los requisitos típicos de Play + bases razonables para AR/BR/US.
- **Limitación**: si la app crece o entra a litigio, un abogado te va a pedir que esté firmada por él.
- Para salir del paso y mandar a Play Store, podés subirlo así, poner la fecha de vigencia y versionar cuando lo apruebes.

### Opción 2 (recomendada): darle el draft a un abogado
- Los archivos viven en `docs/legal/{es-AR,en,pt-BR}/{privacy,terms}.md`.
- También está la **fuente canónica** en `src/i18n/locales/{es-AR,en,pt-BR}/legal.json` (es-AR es la fuente; en y pt-BR son espejos).
- Estructura que ya cubre lo que Play/Data Safety/LGPD piden:

**Privacy (8 secciones):**
1. Introducción
2. Datos que recopilamos  ← declaramos: email, tickets, hogares, suscripción Pro
3. Finalidades del tratamiento
4. Terceros  ← declaramos: Supabase (hosting+auth), RevenueCat (pagos), Apple/Google (pagos)
5. Conservación de los datos
6. Eliminación de la cuenta
7. Tus derechos  ← acceso, rectificación, supresión (LGPD/AR/LPDP)
8. Contacto

**Términos (9 secciones):**
1. Aceptación
2. Descripción del servicio
3. Tu cuenta
4. Suscripciones y pagos  ← menciona cancelación por la tienda (política de Play/App Store)
5. Licencia de uso
6. Limitación de responsabilidad
7. Cambios en estos términos  ← re-gate automático cuando bumpees versión
8. Legislación aplicable  ← AR (CABA) por defecto en es-AR; en y pt-BR tienen "según tu jurisdicción" o lo que tu abogado indique
9. Contacto

### Datos que la privacy tiene que declarar (matchear con el **Data Safety form de Play Console**)

Esto es lo que declaramos hoy en el draft — tiene que ser **idéntico** a lo que pongas en la consola cuando llenes el formulario:

| Categoría Play | Lo que decimos |
|---|---|
| Información personal → Dirección de email | sí (Supabase auth) |
| Información financiera → Historial de compras | sí (RevenueCat) |
| Contenido del usuario → Fotos | sí (escaneo de tickets con cámara/galería) |
| Contenido del usuario → Otro contenido | sí (categorías, presupuestos, hogares) |
| Funciones de la app → Interacciones | sí |
| Compartido con terceros | Supabase (datos de cuenta + contenido), RevenueCat (compras), Apple/Google Play (pagos) |
| Recolectado → ¿es necesario? | Sí |
| ¿Se cifran en tránsito? | Sí (HTTPS) |

**Lo que NO declaramos** (porque no usamos):
- Ubicación ❌ (no hay `expo-location`)
- Identificadores de dispositivo/publicidad ❌
- Contactos, calendario, micrófono ❌ (el RECORD_AUDIO lo sacamos en #118)
- Salud, navegación web, etc.

Si tu abogado te cambia/agrega algo (ej. un proveedor nuevo, una categoría de datos extra), lo actualizamos en los 3 locales + regeneramos los mirrors.

---

## C) Mecánica para regenerar (cuando cambies el copy)

El flujo es: editar catálogos → regenerar mirrors → commit.

### 1. Editar la fuente canónica

Los catálogos en `src/i18n/locales/{es-AR,en,pt-BR}/legal.json` son la **fuente de verdad**. Cada sección es un array de objetos con `id`, `title`, `body`. Ejemplo:

```json
{
  "privacy": {
    "sections": [
      { "id": "intro", "title": "Introducción", "body": "..." },
      { "id": "data", "title": "Datos que recopilamos", "body": "..." }
    ]
  }
}
```

- **Editá primero `es-AR/legal.json`** (la fuente).
- Después actualizá `en/legal.json` y `pt-BR/legal.json` con la traducción.
- Mantené los mismos `id` de sección en los 3 locales (el harness `test:legal-content` rompe si falta una).

### 2. Regenerar los mirrors en `docs/legal/`

Una sola línea:

```bash
node scripts/generate-legal-markdown.mjs
```

Esto lee los 3 catálogos y reescribe los 6 `.md` en `docs/legal/`. El harness **`test:legal-content`** corre automáticamente en `pnpm test` y verifica que:
- los 6 mirrors existen,
- son **byte-idénticos** a una regeneración fresca (no drift),
- contienen el texto de cada sección verbatim.

Si rompe, el test te dice qué sección/locale se desincronizó.

### 3. Cuando el abogado apruebe el copy final → bumpear la versión

Cuando reemplaces el BORRADOR por copy aprovada, hay que **cambiar el version string** para que el gate re-pregunte a usuarios existentes. En `src/features/legal/legal-versions.ts`:

```ts
export const LATEST_LEGAL_VERSIONS = {
  privacy: '2026-09-18',  // ← cambiar a la fecha de aprobación
  terms:   '2026-09-18',
} as const;
```

El formato es **ISO date** (ya enforced server-side en la migración 0038 con `CHECK (version ~ '^\d{4}-\d{2}-\d{2}$')`). Bumping la fecha dispara el gate de re-aceptación para todos los usuarios existentes que tengan una versión anterior registrada.

### 4. Borrar el marker de BORRADOR

En cada `.md` generado hay una línea:
```
> BORRADOR — Este texto está pendiente de revisión legal.
```
Y en el header:
```
_ISO version 2026-09-18 · DRAFT status · ...
```

Cuando el copy sea final, editá los catálogos para sacar esas dos líneas y regenerá. El generator las emite desde el JSON (están en la sección `draftNotice` de cada catálogo).

---

## Resumen — qué hago yo y qué hacés vos

| Paso | Quién |
|---|---|
| Habilitar GitHub Pages en el repo | **Vos** (Settings → Pages → main/docs) |
| Decirme cuando esté activo para curl-verify | **Vos** |
| Redactar/pedir copy legal final | **Vos** (o tu abogado) |
| Editar `src/i18n/locales/*/legal.json` | **Vos** (yo te ayudo si querés) |
| Correr `node scripts/generate-legal-markdown.mjs` + commit | Yo cuando me digas |
| Bumpear `LATEST_LEGAL_VERSIONS` cuando se apruebe | Yo cuando me digas |
| Llenar el **Data Safety form** en Play Console | **Vos** (con la tabla de arriba como guía) |
| Pegar las URLs en el campo "Privacy Policy" del Play listing | **Vos** (yo te paso la lista una vez verificadas) |

Cuando habilites Pages, avisame y hago el curl + te paso las URLs exactas listas para copiar en la consola de Play.
