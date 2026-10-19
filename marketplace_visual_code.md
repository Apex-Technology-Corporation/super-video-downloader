# Prompt: publicar una extensión de Chrome en la Web Store

Playbook reutilizable. Reemplazá `{{NOMBRE_PROYECTO}}` por el nombre real del
proyecto y pegale este prompt a Claude en la raíz del repo de la extensión.

> Nota: pese al nombre del archivo, esto es para la **Chrome Web Store**
> (o Edge Add-ons), no para el Marketplace de VS Code — son cosas
> distintas. Si el proyecto es una extensión de VS Code (`package.json`
> con `"engines": {"vscode": ...}`), este prompt no aplica; se usa `vsce
> package` / `vsce publish` en su lugar.

---

## Prompt

```
Quiero publicar {{NOMBRE_PROYECTO}} en la Chrome Web Store. Ayudame con
todo el proceso:

1. Revisá manifest.json y confirmá que es Manifest V3 válido.

2. Generá (o corregí) un script de build multiplataforma que:
   - Valide que manifest.json sea JSON válido.
   - Verifique que existan todos los archivos declarados (íconos, scripts,
     popup, etc.) antes de empaquetar.
   - Valide sintaxis JS con `node --check` si Node está disponible.
   - Empaquete SOLO los archivos necesarios en tiempo de ejecución (nada de
     scripts/, README, .git, node_modules) en un .zip dentro de dist/.
   - CRÍTICO en Windows: si usás PowerShell Compress-Archive con rutas tipo
     "icons\icon16.png", los archivos quedan en la RAÍZ del zip en vez de
     en la carpeta icons/, y Chrome Web Store lo rechaza con "Falta el
     archivo de ícono". Usar en su lugar
     [System.IO.Compression.ZipFile]::CreateEntryFromFile con la ruta
     relativa como nombre de entry, para preservar la estructura de
     carpetas. Verificalo listando las entries del zip antes de darlo
     por bueno.

3. Generá 3 capturas de pantalla (1280x800 o 640x400, mínimo 1, máx. 5)
   mostrando la extensión en uso, con datos de ejemplo realistas (no
   lorem ipsum). Si hay Chrome o Edge instalado localmente, usá
   `--headless=new --screenshot=<ruta_absoluta> --window-size=W,H` sobre
   un HTML mockup que reproduzca el popup/UI real de la extensión
   (copiá los estilos reales, no inventes un diseño nuevo). Guardalas en
   store-assets/.

4. Generá también:
   - Imagen promocional pequeña (440x280).
   - Imagen de marquesina (1400x560), opcional pero recomendable.

5. Redactá el texto para la ficha de Play Store:
   - Descripción de un solo propósito (máx. 1000 caracteres).
   - Descripción larga con lista de características, basada en el
     README real del proyecto (no inventar features).
   - Categoría e idioma sugeridos.

6. Para la pestaña de Privacidad del Dashboard, redactá:
   - Justificación de cada permiso declarado en manifest.json
     (storage, activeTab, host_permissions, etc.), explicando por qué
     es necesario para el propósito único de la extensión.
   - Respuesta a "¿Usás código remoto?" (grepeá el código en busca de
     eval, new Function, fetch de scripts remotos, <script src="http...
     antes de responder — no asumas que es "No").
   - Qué casillas de "Uso de datos" marcar/no marcar, basado en lo que
     la extensión realmente recolecta (revisá el código, no el
     marketing).

7. Si la extensión pide host_permissions amplios (<all_urls>) o
   recolecta cualquier dato, necesita una Política de Privacidad
   pública. Generá una página HTML standalone (sin dependencias
   externas, apta para GitHub Pages) en docs/privacy.html, con:
   - Qué hace la extensión.
   - Qué datos recolecta (tabla) o una afirmación clara de que no
     recolecta nada.
   - Qué NO hace (lista explícita: no vende datos, no usa analítica,
     no carga código remoto, etc. — solo lo que sea cierto).
   - Tabla de permisos y su justificación.
   - Cómo borrar los datos (generalmente: desinstalar la extensión).
   - Email de contacto.
   Generá también docs/index.html como landing del proyecto, con un
   botón que linkee a privacy.html, para servir ambas con GitHub Pages
   (Settings → Pages → Source: rama y carpeta /docs).

8. Guiame paso a paso por el Dashboard
   (chrome.google.com/webstore/devconsole):
   - Subir el .zip.
   - Completar Ficha de Play Store con lo redactado en el paso 5.
   - Completar Privacidad con lo del paso 6, y la URL de GitHub Pages
     del paso 7.
   - Completar Distribución (gratis, público, regiones).
   - Configurar y verificar el email de contacto del publicador en
     Configuración (paso obligatorio antes de poder publicar).
   - Enviar a revisión, explicándome cualquier advertencia que aparezca
     (ej. demoras por host_permissions amplios) antes de que yo decida
     si continuar o ajustar el manifest.

No asumas nada del contenido: leé manifest.json, popup.html/css/js (o el
UI real de la extensión) y el README antes de redactar textos o generar
capturas.
```

---

## Checklist rápido (una vez hecho el prompt de arriba)

- [ ] `manifest.json` válido, íconos declarados presentes
- [ ] Script de build genera un `.zip` con estructura de carpetas correcta
- [ ] Mínimo 1 captura de pantalla subida
- [ ] Descripción, categoría e idioma completos en Ficha de Play Store
- [ ] Justificación de cada permiso completa en Privacidad
- [ ] "¿Usás código remoto?" respondido correctamente (grepear antes)
- [ ] Casillas de "Uso de datos" reflejan la realidad del código
- [ ] URL de Política de Privacidad pública y accesible sin login
- [ ] Email de contacto del publicador configurado y verificado en Configuración
- [ ] Distribución (pago/región/visibilidad) revisada
- [ ] Enviado a revisión

## Errores comunes ya vistos

| Síntoma | Causa | Solución |
|---|---|---|
| "Falta el archivo de ícono icons/iconXX.png" al subir el zip | `Compress-Archive` de PowerShell aplana las carpetas cuando se le pasan rutas con `\` | Empaquetar con `System.IO.Compression.ZipFile` pasando la ruta relativa como nombre de entry |
| "No se pudo publicar: falta correo de contacto" | El email de contacto del publicador no está configurado/verificado | Configuración → Correo electrónico de contacto → verificar vía el email que envía Google |
| Diálogo "Se retrasará la publicación" por permisos de host | `host_permissions: ["<all_urls>"]` | Es solo una advertencia si el permiso es genuinamente necesario para el propósito único; confirmar el envío desde el mismo diálogo |
| Política de privacidad inaccesible para el revisor | Se compartió un link privado (ej. un Artifact sin hacer público) | Publicar en GitHub Pages (o cualquier hosting público sin login) en vez de depender de compartir manualmente |
