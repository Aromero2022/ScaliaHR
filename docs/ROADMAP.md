# Scalia HR — Roadmap

> **Nota:** El cierre de autorización (D12 — licenciamiento por módulo, `can()`
> en todas las rutas y acciones, caché por request, guards de flag de módulo y
> permisos completos en create-tenant) se ejecuta antes de la Fase 9a como
> prerrequisito de seguridad para todas las fases siguientes.

> **Regla de inversión (Principio 8):** nada que requiera pago se contrata hasta
> que las fases 9a–22 estén completas y probadas al 100 % en local. Todo lo que
> requiere pago vive en la Fase 23.

---

## Fases completadas

| Fase | Nombre | Estatus |
|------|--------|---------|
| 1–3 | BizX / Employee Central | Completada |
| 4 | Org Chart (EC) | Completada |
| 5 | SDM (Sucesión) | Completada |
| 6 | RBP + Admin Center | Completada |
| 7 | PMGM (Desempeño y Metas) | Completada |
| 8 | TIH (Talent Intelligence Hub) | Completada |
| 9a | Infraestructura local | Completada (PR #45, #48, #49 y #50; criterio de cierre verificado abajo) |
| 9b | Seguridad y rendimiento local | Completada (PR #51, #52, #53, #54 y #57; criterio de cierre verificado abajo) |

---

## Fases planificadas

| Fase | Nombre | Alcance |
|------|--------|---------|
| 9a | Infraestructura local (completada) | Dockerfile, /api/health, worker pg-boss en docker-compose, lib/email con React Email probado en Mailpit, middleware de tenant con *.localhost, db-remote-sync con reset bloqueado, export por tenant, prueba de restauración local y runbook. Todo corre gratis en local. |
| 9b | Seguridad y rendimiento local (completada) | Rate limiting activo, CSP sin unsafe-eval, server-only, caching por tenant, índices, paginación, logs estructurados en JSON, prueba de carga k6 contra Docker, Dependabot y escaneo de secretos. Errores genéricos con request id, sin rutas de debug, redacción de datos sensibles en logs, bitácora de solo inserción y zod en todas las Server Actions. |
| 9c | Sistema de diseño y responsividad | Design tokens, layout y navegación responsive, búsqueda global ⌘K, reglas UX, accesibilidad WCAG 2.2 AA y biblioteca base de componentes, con axe y capturas en 3 breakpoints en CI. Todos los módulos siguientes se construyen sobre ella. |
| 10 | Workflows y Notificaciones | Motor de workflows configurable, notificaciones push/email/in-app, eventos de ciclo de vida del empleado; push por adaptador (local/prueba). Consume el correo y worker de la Fase 9a. |
| 11 | Admin Center base | CRUD de RBP, DPCS, Picklist Center, Import Employee Data, configuración de empresa con Theme Manager por tenant, permiso "Ver dato sensible", reporte de auditoría, política de login y reseteo de contraseña por RH. |
| 12 | Consola de plataforma y suscripciones | Catálogo de planes, alta de clientes, facturación por adaptador (local/prueba), consola del proveedor, acceso de soporte, tenants sandbox, canales de release y conversión demo → cliente. |
| 13 | API pública e integraciones | API REST versionada, API keys, OAuth2, webhooks salientes, documentación OpenAPI. Integraciones con terceros por adaptador (local/prueba). |
| 14 | Onboarding y Offboarding | Alta y preboarding, captura de datos fiscales, firma electrónica por adaptador (local/prueba), tareas por responsable, offboarding con revocación de accesos. |
| 15 | JPB + realineación de TIH | Job Profile Builder: biblioteca de atributos, escalas, tags, Growth Portfolio. Realineación de TIH como capa de skills. |
| 16 | PMGM v2 | Plantillas de formulario, rating scales, route maps, metas de desempeño. |
| 17 | 360 Multi-Rater | Evaluaciones multi-evaluador con formularios configurables y anonimato parcial. |
| 18a | Calibración y Sucesión | Calibración, performance vs. potencial, 9-box, talent pools, sucesión y organigrama de sucesión. |
| 18b | Career Development y mentoring | Metas de desarrollo, Career Worksheet, rol objetivo, mentoring. |
| 19 | CPM y Feedback Continuo | Continuous Performance Management: check-ins periódicos y feedback continuo. |
| 20 | Retención y Bloqueo (DRTM) + autoservicio ARCO | Data Retention & Transparency Module, incluido el autoservicio ARCO. |
| 21 | Time Tracking | Registro de tiempo, aprobaciones, integración con nómina por adaptador (local/prueba). Consume la API de la Fase 13. |
| 22 | RCM | Recruiting Management: requisiciones, candidatos, pipeline y ofertas. Al contratar un candidato, inicia el Onboarding de la Fase 14. |
| 23 | Lanzamiento a producción | Única fase con servicios de pago: dominio y Cloudflare, Supabase staging/producción en Pro, Railway, Resend, CI/CD y preview por PR, Sentry, uptime, réplicas, k6 en staging, respaldos diarios y proveedores reales detrás de los adaptadores. Requisito de entrada: fases 9a–22 completas y probadas en local. PITR y export por tenant solo con el primer cliente facturable. |

---

## Fase 9a — Infraestructura local

Todo corre gratis en local (Docker + Supabase local). En esta fase no se crea ningún proyecto ni servicio remoto; su contratación ocurre en la Fase 23.

### Contenedor

- Dockerfile multi-etapa con output: "standalone", Node 22 LTS, usuario no root y turbo prune @scaliahr/web.
- Health check /api/health que valida la app y la conexión a la base de datos.
- Rollback documentado en un runbook (en local: volver a la imagen anterior en docker-compose).

### Worker en segundo plano

- Servicio separado en docker-compose para correos, workflows, jobs programados, exports por tenant e integraciones.
- Cola persistente en Postgres (pg-boss o equivalente) con reintentos, backoff y cola de errores (dead letter).

### Correo (lib/email)

- Módulo lib/email con plantillas React Email, multi-idioma y con la marca de cada tenant.
- Envío detrás de un adaptador: en local entrega en el Mailpit de Supabase local, donde se prueba cada plantilla. Resend se conecta al mismo adaptador en la Fase 23.

### Tenant por subdominio

- Middleware que resuelve el tenant por subdominio o por código de empresa, probado en local con *.localhost (`<cliente>.localhost`).

### Migraciones

- db-remote-sync con un modo producción que solo aplica migraciones; el modo reset queda bloqueado para producción (coherente con D7). El bloqueo se prueba en local, sin tocar ningún proyecto remoto.
- Migraciones compatibles hacia atrás (expand/contract).

### Respaldos

- Export lógico por tenant ejecutado por el worker, restaurable sin afectar a los demás tenants, probado contra Supabase local.
- Prueba de restauración local documentada (completa y por tenant).

**Criterio de cierre:** web y worker arrancan en Docker contra Supabase local, /api/health responde, cada plantilla de correo llega a Mailpit, `<cliente>.localhost` resuelve su tenant, el modo reset de db-remote-sync queda bloqueado para producción y una restauración local probada (completa y por tenant).

**Estado: completada** (PR #45, #48, #49 y #50). Cada punto del criterio se prueba en CI en cada PR:

| Punto del criterio | Evidencia |
|--------------------|-----------|
| Web y worker arrancan en Docker contra Supabase local | Job `docker`: `npm run local:up` construye y arranca ambas imágenes (D17) |
| /api/health responde | Prueba de humo de `local:up` y `health.test.ts` (D17) |
| Cada plantilla de correo llega a Mailpit | `email.test.ts` del worker (invitación, reseteo y notificación) y el correo de humo de `local:up` (D20) |
| `<cliente>.localhost` resuelve su tenant | `tenant-host.test.ts`: middleware real con sesiones reales; otro tenant, inexistente o suspendido reciben el mismo 404 (D21) |
| Reset de db-remote-sync bloqueado para producción | `db-sync-guard.test.ts` y `db-sync-modes.test.ts`, sin tocar proyectos remotos (D22) |
| Restauración local probada, completa y por tenant | `backup.test.ts` del worker: export por el worker, restauración por tenant con los demás intactos y restauración completa en sitio (D23) |
| Rollback a la imagen anterior en docker-compose | Simulacro del job `docker` y `docs/RUNBOOK.md` (D24) |

---

## Fase 9b — Seguridad y rendimiento local

Todo se prueba en local, contra el stack en Docker y Supabase local.

### Rate limiting

`lib/rate-limit.ts` y `check_rate_limit` ya existen, pero no se usan en ningún flujo.

- Conectarlo en login, MFA, reseteo de contraseña, alta de tenant, Server Actions de escritura y la API pública.
- Hacerlo fail-closed en login y MFA: hoy, si la RPC falla, deja pasar la petición.
- Permitir que la RPC funcione sin sesión, porque el login ocurre antes de autenticarse.
- Llave de límite por IP + tenant + usuario; responder 429 con Retry-After.
- Límites configurables por tenant desde Admin Center.
- Activar también los límites nativos de Supabase Auth (en local, en `supabase/config.toml`).

### Endurecimiento

- Quitar 'unsafe-eval' de la CSP y reemplazar 'unsafe-inline' en scripts por nonces.
- Poner productionBrowserSourceMaps: false de forma explícita.
- Proteger las llaves privadas con server-only y una regla de lint que impida importarlas en componentes cliente.
- Dependabot y escaneo de secretos en CI.
- Dejar en cero los advisors de seguridad y rendimiento de Supabase, evaluados contra la base local.

### Caching

- unstable_cache con tags por tenant para picklists, configuración de empresa, tema y catálogos de TIH/JPB; invalidar al guardar desde Admin Center.
- Caché de RBP entre peticiones: hoy no existe (D14: contexto de permisos solo por petición). Si algún día se agrega, la llave debe incluir tenant_id y debe invalidarse en cada cambio de role_grants, group_members o permisos, con un test que demuestre que un permiso revocado deja de valer de inmediato.
- Interfaz de caché lista para cambiar a Redis.
- Cachear unos segundos la consulta de tenant del middleware (D21), invalidando al suspender un tenant.

### Escalabilidad

- Prisma por el pooler (transaction mode) con límites de conexión definidos.
- Revisar índices sobre tenant_id y fechas efectivas; paginación obligatoria en listados.
- Prueba de carga con k6 contra el stack en Docker: 1,000 usuarios concurrentes en un tenant y varios tenants a la vez; objetivo p95 < 500 ms.

### Observabilidad

- Logs estructurados en JSON con request id y tenant id.
- Reporte de errores detrás de un adaptador: en local escribe en los logs JSON. Sentry se conecta al mismo adaptador en la Fase 23.

### Errores, logs y bitácora

- Mensajes de error genéricos al usuario con request id; el detalle solo en logs. `error.tsx` global sin stack trace. Hoy 16 respuestas de Server Actions devuelven al cliente el `error.message` de Supabase o Postgres, y no existe ningún `error.tsx`.
- Ninguna ruta de debug en el build de producción, con un test que lo verifique.
- Redacción de datos sensibles en logs (contraseñas, tokens, CURP, RFC, NSS, CLABE, salario).
- Bitácora de solo inserción: sin UPDATE ni DELETE desde la app. Hoy `audit_logs` solo se escribe vía `write_audit_log` y las políticas RESTRICTIVE ya bloquean UPDATE y DELETE; falta revocar TRUNCATE (siguiente viñeta) y cubrirlo con un test. La única excepción es la supresión ARCO de D10 (`anonymize_user`), que corre en la base y reemplaza datos personales.
- Revocar TRUNCATE a `anon`, `authenticated` y `prisma_app` en las tablas de `public`, con un test: TRUNCATE ignora RLS, y hoy esos roles lo tienen en 37 de las 38 tablas por los grants por defecto de Supabase (también los repite `scripts/db-reset-sync.sh`).
- Validación con zod en servidor en todas las Server Actions (verificar las existentes). Hoy validan con zod las de ARCO, empleados, skills-hub y `createTenant`; faltan `performance/actions.ts` (lee `FormData` sin esquema) y `lib/tenant/actions.ts` (regex manual, aunque D2 dice Zod). `lms-sync`, `provision-tenant` y `get-module-flags` llevan `"use server"` sin ser acciones de cliente: quitárselo o validarlas también.

**Criterio de cierre:** prueba de carga k6 contra Docker aprobada, rate limiting activo y probado, CSP sin unsafe-eval, ninguna llave privada importable desde componentes cliente y un error forzado visible en los logs JSON con su request id y tenant id. Además: ninguna Server Action sin zod, ningún mensaje de error interno visible para el usuario, el test de rutas de debug pasando sobre el build de producción y TRUNCATE revocado.

**Estado: completada** (PR #51, #52, #53, #54 y #57). Cada punto del criterio se prueba en CI en cada PR:

| Punto del criterio | Evidencia |
|--------------------|-----------|
| Prueba de carga k6 contra Docker aprobada | `npm run load:test` (D36): 1,000 usuarios en un tenant y 50 en cada uno de otros tres al mismo tiempo, con 20–40 s entre páginas (modelo de carga de D36): p95 217 ms en estado estable, 0 % de fallos y ninguna página con empleados de otro tenant. Con 2–6 s entre páginas, un proceso web aguanta unos 180 usuarios (p95 209 ms); más allá se escala con réplicas en la Fase 23. El job `docker` de CI corre una versión corta en cada PR |
| Rate limiting activo y probado | `rate-limiting.test.ts` contra Supabase local y `rate-limit-coverage.test.ts`, que con el parser de TypeScript falla si una Server Action o ruta HTTP no gasta un token, también en la forma `export const x = async () =>` (D28, D39) |
| CSP sin unsafe-eval | `csp.test.ts` y el paso del job `docker` que revisa el nonce de cada script de `/login` en la imagen de producción (D29) |
| Ninguna llave privada importable desde componentes cliente | `import "server-only"` en los módulos privilegiados y la regla de lint propia, con `no-server-only-in-client.test.ts` (D30) |
| Error forzado visible en los logs JSON con su request id y tenant id | `error-logging.test.ts` contra Supabase local (D27) |
| Ninguna Server Action sin zod | `zod-coverage.test.ts` (D31, con el parser compartido de D39) |
| Ningún mensaje de error interno visible para el usuario | `no-error-leaks.test.ts` y `safeError()` (D27) |
| Test de rutas de debug pasando sobre el build de producción | `scripts/check-prod-build.mjs` sobre el build de producción en el job Lint · Types · Tests · Build (D32) |
| TRUNCATE revocado | `db-privileges.test.ts`, desde la Data API y desde una conexión de la app (D25) |

---

## Fase 9c — Sistema de diseño y responsividad

Base visual y de interacción sobre la que se construyen todos los módulos desde la Fase 10. Corre en local, sin servicios de pago (Principio 8). Decisión de arquitectura: D19.

### Design tokens

- Design tokens como variables CSS: color, tipografía, espaciado en múltiplos de 4, radios y sombras. Tailwind consume los tokens.
- Espaciado de formularios: label→input 8px, input→ayuda 4px, entre campos 20px, entre secciones 24px.
- Hecho en el PR 1 (D40): tokens semánticos con Tailwind 4 sin paleta por defecto, preset Clean como datos con claro, oscuro y alto contraste derivado, `data-theme` y `data-contrast` sin parpadeo, Inter autohospedada (OFL) y la migración de todos los colores literales.

### Layout y navegación

- Layout Holy Grail / Two Column.
- Navegación: sidebar completo colapsable en escritorio, riel de íconos en tablet y dock inferior de máximo 5 íconos con texto en móvil.
- Búsqueda global con ⌘K.
- Hecho en el PR 2 (D41), salvo ⌘K: shell con landmarks y enlace para saltar al contenido, sidebar colapsable desde 1280 px, rail de 768 a 1279 px y dock de 5 entradas con diálogo "Más" bajo 768 px, todo con la misma lista filtrada por módulo y RBP; sin scroll horizontal a 320 px.

### Responsive

- Grid con auto-fit, clamp() con texto de cuerpo mínimo 16px, container queries para widgets, min(100% - 2rem, 65ch) en textos largos, flex-wrap + gap en chips y aspect-ratio en fotos y video.
- Dashboard de 1 a 4 columnas; tablas que se vuelven tarjetas en móvil; formularios largos por pasos.

### Reglas UX

- Un solo botón primario por pantalla.
- Áreas táctiles de 44px.
- Skeletons en cargas mayores a 400 ms.
- Menús que solo muestran módulos contratados (D12) y permitidos por rol (RBP). El sidebar actual ya filtra por flag de módulo y por `can()` (D14); el riel y el dock usan el mismo filtro.
- Fechas con formato local y la zona horaria del tenant (hoy se muestran ISO crudas: "2026-01-01T00:00:00+00:00"). Hecho en el PR 3 (D42): todas las fechas se formatean en el servidor con `Intl.DateTimeFormat("es-MX")`; los momentos con la zona del tenant (`platform.timezone`, respaldo America/Mexico_City) y reloj de 12 horas, y las fechas sin hora sin convertir de zona. Los componentes cliente reciben texto y un test estático impide que formateen fechas.
- Textos de la UI en un solo módulo, `lib/i18n/es-MX.ts` (D42). Las pantallas que ya están en español y cuyos textos el PR 3 no movió (desempeño, Talent Hub, roles y permisos, ARCO, Admin Center, verificación MFA y los diálogos de cambios del empleado) pasan al módulo cuando se toquen.

### Accesibilidad (WCAG 2.2 AA)

- Labels visibles (nunca solo placeholder).
- Foco visible.
- Navegación completa con teclado.
- Zoom al 200 % sin romper el layout.
- prefers-reduced-motion respetado (framer-motion con useReducedMotion). framer-motion todavía no está en el repo; se agrega en esta fase.
- PersonSearch (D38) como combobox accesible: role=combobox, listbox con aria-activedescendant, navegación con teclado y anuncio de resultados.
- `<html lang>` en "es-MX" (hoy "en"; WCAG 3.1.1) y textos de la UI en español: "Sign in", "Password", "PERFORMANCE SCORE", "ON TRACK", estados como "ACTIVE". El `lang` quedó hecho en el PR 2 (D41). Los textos quedaron hechos en el PR 3 (D42): login, metadatos, dashboard, perfil, empleados, organigrama y alta de MFA en español desde `lib/i18n/es-MX.ts`, y los estados de la base traducidos al mostrarlos con las etiquetas de todos los enums; un test estático falla si vuelve un texto en inglés conocido.

### Credenciales demo en el login

- La pantalla de login muestra "Demo: elena.martinez@acme.dev / Demo1234!" sin condición, también en la imagen de producción. Que solo aparezca con una variable explícita de demo local, apagada por defecto, con un test que lo verifique en el build de producción.
- Hecho en el PR 2 (D41): la pista sale de `SCALIA_DEMO_LOGIN_HINT`, variable del servidor apagada por defecto e ignorada en producción si `APP_BASE_URL` no es local; `check:prod-build` falla si el bundle del cliente trae la contraseña o el correo demo, y CI revisa que el `/login` de la imagen no la muestre.

### Biblioteca base

- Botón, input, stat card, tabla, modal, toast, skeleton y agenda de día y hora con la zona horaria del tenant visible y aria-labels.

### Pruebas

- axe en CI.
- Capturas en 3 breakpoints: 360, 768 y 1280 px (Playwright ya está en `apps/web`).

**Criterio de cierre:** axe sin errores en las pantallas existentes y las 3 capturas aprobadas.

---

## Fase 10 — Workflows y Notificaciones

Motor de workflows configurable, notificaciones push/email/in-app, eventos de ciclo de vida del empleado. Consume el canal de correo y el worker de la Fase 9a.

- Preferencias de notificación por usuario y opción de desuscribirse de correos no críticos.
- Notificaciones push por adaptador (local/prueba); el proveedor real se conecta en la Fase 23.
- Los correos muestran fechas y horas con la zona horaria del tenant (`platform.timezone`), con las mismas reglas de D42: momentos con la zona del tenant y fechas sin hora sin convertir.

---

## Fase 11 — Admin Center base

CRUD de RBP (roles, grupos y asignaciones), DPCS (aviso de privacidad versionado, aceptación al iniciar sesión y Set DPCS Statement Status), Picklist Center, Import Employee Data, configuración de empresa (logo, tema, idioma, política de contraseña y MFA), reporte de auditoría, política de login por cliente (correo, número de empleado o ambos) y reseteo de contraseña por RH.

- Al habilitar roles personalizados, `insert_effective_record` (y cualquier función de la base que hoy autorice por `app_role`) debe validar el permiso RBP en lugar del rol fijo.
- Zona horaria e idioma del tenant (`platform.timezone` y `platform.locale`) editables en la configuración de empresa. Al guardar la zona, llamar `revalidateTag(tenantTimeZoneTag(tenantId))`; sin esto, la zona nueva tarda hasta 60 s en verse (D42).
- Cada Server Action del CRUD de RBP debe llamar `writeAuditLog()` con la acción correspondiente: `ROLE_CREATED`, `ROLE_UPDATED`, `ROLE_DELETED`, `PERMISSION_GRANTED`, `PERMISSION_REVOKED`, `GROUP_MEMBER_ADDED`, `GROUP_MEMBER_REMOVED`. Las entradas deben incluir `entity_id` (UUID del recurso) y `diff` (campos modificados) para trazabilidad completa.

### Theme Manager (D18)

La "configuración de empresa (logo, tema...)" se resuelve con un Theme Manager por tenant, construido sobre los tokens de la Fase 9c.

- 6 presets seleccionables por tenant: Clean (default), Glass, Soft, Midnight, Editorial y Bento. Cada uno con modo claro y oscuro y una variante de alto contraste automática.
- Los presets solo cambian la piel; el layout y la navegación son iguales en todos.
- Estilos excluidos por accesibilidad o legibilidad: Neumorphism, Brutalism, Neo-Brutalism, Y2K, Cyberpunk, Retro y Maximalism.
- Glass: fondo sólido detrás del texto y fallback con prefers-reduced-transparency.
- Marca del cliente: logo claro y oscuro (encabezado, login, correos y PDFs), favicon, fondo de login, banner del dashboard y fondo del preset Glass.
- Colores primario y secundario con validación de contraste (4.5:1 texto, 3:1 componentes); si no cumplen, se ajustan automáticamente.
- Tipografía de una lista cerrada con licencia OFL.
- Íconos: paquete Lucide, Phosphor o Tabler, o íconos propios recoloreados con el color del tema.
- Preferencias por usuario: claro/oscuro/sistema, tamaño de fuente, densidad y reducir movimiento.
- Seguridad: sin CSS libre del cliente; SVG sanitizado en servidor o rasterizado; tipos permitidos PNG, WebP y SVG validados por magic bytes con límite de tamaño; Storage privado por tenant con URLs firmadas.
- El logo de correos y de la app solo puede venir del Storage privado del tenant; no se aceptan URLs externas (evita píxeles de rastreo).
- Cada cambio llama `writeAuditLog()` con `THEME_UPDATED` y `diff`; vista previa antes de publicar y restaurar versión anterior (Principio 5).
- El aviso de privacidad (DPCS) siempre visible en el login, sin importar el tema.

#### Experiencia para administradores sin experiencia técnica

- Asistente en 3 pasos:
  1. Subir logo, con extracción automática de colores y 3 paletas sugeridas.
  2. Elegir uno de los 6 presets en tarjetas que muestran el dashboard real del tenant con su logo.
  3. Vista previa en vivo de login, dashboard y formulario en escritorio y móvil, y publicar.
- Validación de contraste con mensajes en lenguaje simple y botón "Aplicar sugerencia"; nunca mostrar ratios técnicos al usuario básico.
- Recorte, ajuste y compresión de imágenes en el navegador con guías de tamaño; errores de upload que dicen qué hacer. El servidor sigue aplicando las validaciones de seguridad de arriba (magic bytes, límite de tamaño, SVG sanitizado).
- Estados borrador y publicado; deshacer; restaurar versión anterior con un clic; "Volver al tema predeterminado".
- Etiquetas sin jerga ("Color principal", "Logo para fondo oscuro") y ayuda ⓘ en cada campo indicando dónde se ve.
- Modo avanzado oculto por defecto: hex, tipografía, paquete de íconos e íconos propios, dentro de los mismos límites de D18.
- Permiso RBP "Administrar tema", independiente del resto de Admin Center.

**Criterio de cierre del Theme Manager:** un usuario sin experiencia cambia logo, colores y preset, y publica, en menos de 10 minutos sin ayuda.

### Datos sensibles

- Permiso RBP "Ver dato sensible": CURP, RFC, NSS, CLABE y salario enmascarados por defecto; botón "mostrar" solo con ese permiso, y cada revelación registrada con `writeAuditLog()`. Hoy la ficha del empleado muestra CURP, RFC y salario completos a quien pasa RLS (el propio empleado, su jefe directo y admin; D6). NSS y CLABE todavía no existen en el esquema: llegan con la Fase 14. `can()` ya admite permisos por campo (`field_key`).

### Protección de cuentas

- Pantalla para que un admin con permiso y AAL2 vea las cuentas con login bloqueado por rate limit y las desbloquee, con writeAuditLog().
- Correo al usuario cuando su cuenta acumula intentos fallidos (vía lib/email), sin revelar si el correo existe a quien intenta entrar.
- Bloqueo progresivo en lugar de fijo (por ejemplo, 1, 5 y 15 minutos), configurable por tenant.

---

## Fase 12 — Consola de plataforma y suscripciones

Catálogo de planes y módulos, alta de clientes por autoservicio con periodo de prueba y alta asistida, activación y suspensión por pago, facturación por adaptador (local/prueba). Consola del proveedor separada del Admin Center del cliente. Subdominio o código de empresa por tenant. Acceso de soporte del proveedor (temporal, auditado, autorizado por el cliente).

- Acceso de soporte del proveedor otorgado por el cliente desde Admin Center, temporal, solo lectura por defecto, con break-glass con motivo obligatorio, banner "Modo soporte", MFA obligatorio y registro en la bitácora del cliente.
- Tenants sandbox ligados al tenant de producción, con refresh y datos anonimizados (LFPDPPP).
- Canales de release con flags (universales, opt-in, por módulo D12) y clientes preview.
- Conversión de demo a cliente con licencia: activa el export por tenant y los compromisos de RPO/RTO del contrato.
- Facturación y cobro por adaptador (local/prueba): la activación y suspensión por pago se prueban con la implementación de prueba; el proveedor real se contrata en la Fase 23.
- Al prender o apagar un módulo, llamar revalidateTag(moduleFlagsTag(tenantId)); al suspender un tenant, llamar tenantAccessCache().invalidate(tenantId). Sin esto, un módulo apagado sigue visible hasta 60 s y un tenant suspendido entra hasta 5 s (D35).

---

## Fase 13 — API pública e integraciones

- API REST versionada (/api/v1) con aislamiento por tenant y permisos según RBP.
- API keys y OAuth2 client credentials que se crean, rotan y revocan desde Admin Center.
- Rate limiting por llave, auditoría de cada llamada y paginación estándar.
- Webhooks salientes firmados y con reintentos (alta, baja, cambio de puesto, aprobación de workflow).
- Documentación OpenAPI y colección de Postman.
- Primeras entidades: empleados, organización/posiciones, ausencias y tiempo.
- Integraciones con sistemas de terceros por adaptador (local/prueba); los proveedores reales se conectan en la Fase 23.

---

## Fase 14 — Onboarding y Offboarding

Depende de: Workflows (10), Admin Center (11), worker y lib/email (9a), API (13). No depende de RCM.

### Onboarding

- Alta del nuevo ingreso en EC con fecha efectiva.
- Convertir `users.hire_date` de `timestamptz` a `date` con expand/contract (D22). Hoy guarda la medianoche UTC y se muestra con `formatDateOnly()`, que depende de que la sesión de Postgres esté en UTC (D42).
- Preboarding: portal antes del día 1 con acceso temporal.
- Captura de datos personales y fiscales (RFC, CURP, NSS, CLABE) con permisos por campo (PII sensible).
- Documentos y firma electrónica (contrato, aviso de privacidad, NDA); firma electrónica por adaptador (local/prueba).
- Tareas por responsable (RH, manager, TI, buddy) con plantillas por puesto o ubicación, configurables en Admin Center.
- Asignación automática de cursos LMS y metas iniciales.
- Encuestas a 30/60/90 días.
- Tarea de alta en IMSS.

### Offboarding

- Baja en EC con motivo y fecha efectiva.
- Tareas de devolución de equipo y revocación de accesos (sesiones, LMS, integraciones).
- Desde D34 un JWT revocado sigue pasando el middleware hasta que expira (jwt_expiry 900 s). La baja debe cortar el acceso de inmediato: marca de revocación por usuario leída en el middleware (cacheable como D35) o jwt_expiry menor, con prueba de que un usuario dado de baja recibe 401/redirect en el siguiente request.
- Entrevista de salida y transferencia de conocimiento.
- Datos de finiquito hacia nómina vía API; integración con nómina por adaptador (local/prueba).
- Tarea de baja en IMSS.
- Elegibilidad de recontratación.
- Al cerrar, aplica la política de retención de DRTM (Fase 20).

**Criterio de cierre:** un alta completa desde preboarding hasta el día 1 y una baja con revocación de accesos verificada, ambas con su bitácora de auditoría.

---

## Fase 16 — PMGM v2

Plantillas de formulario, rating scales, route maps y metas de desempeño.

- Convertir `period_start`, `period_end` y `due_date` de `performance_goals` de `timestamptz` a `date` con expand/contract (D22). Hoy guardan la medianoche UTC y se muestran con `formatDateOnly()`, que depende de que la sesión de Postgres esté en UTC (D42).

---

## Fase 23 — Lanzamiento a producción

Única fase en la que se contratan servicios de pago (Principio 8). Conecta los proveedores reales detrás de los adaptadores ya probados en local; no agrega funcionalidad de producto.

### Requisito de entrada (antes del primer cliente)

- Fases 9a–22 completas y probadas al 100 % en local.
- Cambiar el factor MFA del owner.
- Sacar los datos demo de las migraciones a seed.sql.
- Sin credenciales demo en ninguna pantalla.
- `can()` como función SECURITY DEFINER en la base.
- Verificar la bitácora de auditoría: **parcialmente resuelto** (PR #42). Login (`AUTH_LOGIN`), MFA (`MFA_ENROLL`, `MFA_VERIFY`, `MFA_ENROLL_FAILED`, `MFA_VERIFY_FAILED`) ya se registran y Admin Center los muestra con `entity`, `entity_id` y `diff`. Desde D28 (Fase 9b) el login y la verificación MFA corren en el servidor, que escribe `AUTH_LOGIN`, `MFA_VERIFY` y `MFA_VERIFY_FAILED`, y los logins fallidos quedan en los logs JSON. Pendiente: cambios de permisos (Fase 11 CRUD de RBP), los logins fallidos en la bitácora y las llamadas directas a la API de Supabase Auth (Known Risk "Login Audit Depends on the Client" en ARCHITECTURE.md).
- Cerrar los Known Risks de ARCHITECTURE.md.
- Comprobar en staging que una llamada directa a la API de Supabase Auth con la anon key recibe 429 de los límites nativos.
- CAPTCHA (Cloudflare Turnstile) en login y alta de tenant, conectado al adaptador desde local con una implementación de prueba.

### Dominio y CDN

- app.scaliahr.com y subdominios por tenant (<cliente>.scaliahr.com) con SSL comodín.
- Assets con cache inmutable y CDN (Cloudflare) delante de Railway.

### Ambientes

- Dos proyectos de Supabase en plan Pro: staging y producción. Las migraciones se validan en staging y se promueven a producción con el modo producción de db-remote-sync (solo aplica migraciones; reset bloqueado, Fase 9a).
- Dos ambientes en Railway (staging y producción), cada uno con sus propias variables y secretos. Ninguna llave de producción vive en staging ni en el repo.
- Worker como servicio separado en Railway, con la misma imagen probada en docker-compose (Fase 9a).
- Réplicas horizontales configuradas en Railway.
- Límites nativos de Supabase Auth (Fase 9b, D28) activados también en staging y producción, con un 429 comprobado en staging. Como el login y el MFA corren en el servidor, las llamadas a Auth deben mandar la IP del usuario en `Sb-Forwarded-For` (llave secreta y `security_sb_forwarded_for_enabled`); si no, todos los usuarios comparten el límite de la IP del servidor.
- Un proxy delante de la app (Cloudflare o Railway) que escriba `X-Forwarded-For`, del que `lib/rate-limit` toma la IP del cliente (D28).
- Advisors de seguridad y rendimiento de Supabase en cero en staging y producción, incluida la protección de contraseñas filtradas (D11), que requiere plan Pro.

### CI/CD

- main despliega a staging; un tag o release despliega a producción. El CI actual es requisito para desplegar.
- Preview por Pull Request contra Supabase staging.
- El runbook de la Fase 9a se completa con el rollback en Railway.

### Correo transaccional (Resend)

- Dominio de envío verificado con SPF, DKIM y DMARC.
- Resend como SMTP personalizado en Supabase Auth: invitaciones, confirmación de cuenta y reseteo de contraseña.
- Resend conectado al adaptador de lib/email (Fase 9a).
- Webhooks de Resend que alimentan una bitácora de envío por tenant (enviado, entregado, rebotado, queja).
- API keys separadas por ambiente; staging solo envía a correos de prueba.

### Observabilidad

- Sentry en web y worker, con releases ligados al despliegue, conectado al adaptador de reporte de errores (Fase 9b).
- Uptime monitoring sobre /api/health con alertas a correo o Slack.
- Panel de métricas: errores, latencia, jobs fallidos, correos rebotados y eventos de rate limiting.

### Rendimiento

- Prueba de carga con k6 en staging: 1,000 usuarios concurrentes en un tenant y varios tenants a la vez; objetivo p95 < 500 ms.
- Dimensionar réplicas del web con el resultado de D36: un proceso aguanta unos 180 usuarios con 2–6 s entre páginas; los caches en memoria (D35) pasan a un store compartido.

### Respaldos

- Respaldo diario del plan Pro desde que exista el proyecto de producción.
- Tenants demo/prueba: sin RPO comprometido; sus términos lo indican.
- RPO y RTO por escrito para clientes con licencia, incluidos en el contrato.
- Prueba de restauración mensual documentada (completa y por tenant).

### Proveedores reales detrás de los adaptadores

- Se contrata cada proveedor real y se conecta a su adaptador: notificaciones push (Fase 10), facturación y cobro (Fase 12), integraciones con terceros (Fase 13), firma electrónica y nómina (Fase 14) e integración con nómina (Fase 21). La implementación local o de prueba se conserva para desarrollo y CI.

### Al dar de alta el primer cliente facturable

Contratar PITR y encender su export por tenant:

- Point-in-Time Recovery: diferido; se contrata al dar de alta el primer cliente facturable (antes no). Cubre todo el proyecto de producción.
- Export lógico por tenant ejecutado por el worker, diario, solo para tenants con licencia activa (se enciende al convertir una demo en cliente), restaurable sin afectar a los demás tenants.

**Criterio de cierre:** ambos ambientes operando, despliegue continuo funcionando, un correo real enviado desde cada ambiente, una restauración probada (completa y por tenant), prueba de carga k6 en staging aprobada y alertas llegando ante un error forzado.

---

## Tabla de cumplimiento

> Estados verificados contra el código y la base local de main (commit 0a3c70f) el 2026-11-04, revisados de nuevo con main en 62ea0cc (PR #45, Fase 9a PR 1), con main en 5908222 (PR #48, Fase 9a PR 2: correo y tenant por subdominio, D20 y D21), con main en 3ca8d5d (PR #49, Fase 9a PR 3: migraciones seguras, D22), con main en b101eb7 (PR #50, Fase 9a PR 4: respaldos y runbook, D23 y D24), con main en c28be3f (PR #51, Fase 9b PR 1: privilegios de la base y advisors, D25 y D26), con main en 20e48b5 (PR #52, Fase 9b PR 2: errores seguros y logs JSON, D27), con main en a961e52 (PR #53, Fase 9b PR 3: rate limiting y filtro de búsqueda, D28), con main en e15e0ef (PR #54, Fase 9b PR 4: endurecimiento, D29 a D33), con main en ae25e87 (PR #57, Fase 9b PR 5: rendimiento, D34 a D39), con main en 8f13442 (PR #60, Fase 9c PR 1: design tokens, D40) con main en cdb1ec2 (PR #61, Fase 9c PR 2: layout responsive y navegación, D41) y con la rama del PR 3 de la Fase 9c (textos en español y fechas con la zona del tenant, D42). Cada fase, al cerrarse, actualiza el estado de sus filas.

| Norma o control | Dónde se cumple | Estado |
|-----------------|-----------------|--------|
| RLS por tenant | Todas las tablas + D3 (Prisma sin bypass) + D6 + D17 (`pgboss`) + D20 (`email_enqueuer`) + D22 (`ops`) + D25 (privilegios) + D35 y D42 (funciones solo para `prisma_app`) | Cumple: las 38 tablas de `public`, las 11 de `pgboss` y la de `ops` tienen ENABLE + FORCE RLS y ningún rol de la app (incluidos `worker_app` y `email_enqueuer`) tiene BYPASSRLS. `email_enqueuer` solo inserta trabajos de `email.send` y no lee su contenido; `worker_app` lee la marca del tenant solo a través de `email_branding()`. Desde D25 ningún rol de la app tiene TRUNCATE, TRIGGER, REFERENCES ni MAINTAIN en ninguna tabla, tampoco en las que creen migraciones futuras, con test. Los advisors de seguridad y rendimiento de Supabase quedan en cero contra la base local y CI lo verifica. Desde D42, `public.tenant_time_zone()` (SECURITY DEFINER, `search_path` vacío) da a `prisma_app` solo la zona horaria de un tenant; anon y las sesiones de la Data API reciben 42501, y la política SELECT de `system_configurations` sigue siendo solo para admins, con tests contra la base local |
| Secretos fuera del cliente y del repo | .env fuera del repo + D4 + D17 (`.dockerignore`, `.env.docker` ignorado e imágenes revisadas en CI) + D20 (`EMAIL_ENQUEUE_DATABASE_URL` solo en el servidor) + D30 (server-only) + D33 (gitleaks) + D39 (permisos mínimos en todos los workflows) | Cumple: los módulos con llaves o conexiones privilegiadas (`admin-client`, `tenant-client`, `lib/email`, `moodle-client`) llevan `import "server-only"`, así que importarlos desde un componente cliente rompe el build, y una regla de lint propia lo marca antes, también a través de otros módulos. gitleaks revisa todo el historial de git en cada PR; la única excepción son las llaves demo públicas de Supabase local. El `GITHUB_TOKEN` de CI y de db-remote-sync solo puede leer el repositorio (`permissions: contents: read`), y los checkouts del escaneo de secretos y de db-remote-sync no dejan el token en `.git/config` (`persist-credentials: false`, D39). El build no publica source maps del navegador (D29) |
| Rate limiting (429) | 9b (D28) + 23 (límites nativos de Auth en el proyecto alojado) | Cumple en local: login, MFA, alta de tenant, todas las Server Actions y las rutas HTTP gastan un token de `rate_limit_consume()` antes de actuar; solo `prisma_app` puede llamarla. Login, MFA y alta de tenant fallan cerrados. Llaves por IP, por cuenta (tenant + correo) y por usuario en su tenant, guardadas como hash. Las rutas responden 429 con Retry-After y las Server Actions el tiempo de espera. Cada tenant ajusta sus límites de escritura y API desde Admin Center, dentro de topes. Probado contra Supabase local y en la imagen de producción; un test estático con el parser de TypeScript falla si una Server Action o ruta no gasta un token (D39). Los límites nativos de Supabase Auth quedan en `config.toml`, pero la CLI local no aplica los de IP; en la Fase 23 se activan en el proyecto alojado con `Sb-Forwarded-For` |
| Fuerza bruta contra la API de Supabase Auth directa | 23 (límites nativos + CAPTCHA) | Pendiente: riesgo aceptado por el Principio 8 (D28) |
| Bloqueo de cuentas por terceros (lockout) | 9b (D28) + 11 (desbloqueo, aviso y bloqueo progresivo) | Parcial: el bloqueo dura 60 s; falta desbloqueo por admin y aviso al usuario |
| CSP estricta | 9b (D29) + 9c (D40) | Cumple: el middleware manda en cada respuesta una CSP con un nonce nuevo y `'strict-dynamic'`; los scripts solo corren con ese nonce, sin `'unsafe-inline'` ni `'unsafe-eval'` (este solo en `next dev`). Todas las páginas se renderizan por petición para llevar el nonce. Probado en la imagen de producción: cero violaciones en 11 páginas con login, formularios y MFA; un script inline inyectado y `eval()` quedan bloqueados. CI revisa que cada script de `/login` lleve el nonce. Los estilos conservan `'unsafe-inline'`. Desde D40 las fuentes son autohospedadas: `font-src 'self'` y `style-src` sin orígenes externos; `check-csp` falla si aparece uno o si la página carga fuentes de Google, y el script inicial del tema lleva el nonce. En la imagen de producción: cero violaciones en 32 cargas (8 páginas en claro, oscuro y alto contraste claro y oscuro) |
| Validación de entradas (zod) | 9b (D28, D31) | Cumple: toda Server Action con entrada la valida con zod antes de usarla, también las que leen FormData (objetivos y feedback de desempeño) y el cambio y la revocación de tenant; los trabajos de correo (al encolar y en el worker, D20), el código de empresa y la configuración del worker (D21) también. Un test estático falla si una Server Action con parámetros no valida, y solo las acciones reales llevan `"use server"`. Los filtros `or()` de PostgREST llevan cada valor entre comillas (`lib/postgrest/filters.ts`), así que "a,id.eq.1)(" ya no agrega condiciones. Los números de página y la búsqueda de personas (`/api/colleagues`) también se validan con zod (D38) |
| Errores sin exponer detalles | 9b (D27) | Cumple: ningún mensaje de la base, de Supabase Auth ni de servicios llega al usuario; las Server Actions y páginas pasan por `safeError()` (mensaje genérico con el request id), login y MFA usan mensajes genéricos, y `error.tsx`/`global-error.tsx` muestran solo un texto genérico y el digest. Un test estático falla ante cualquier `error.message` hacia el usuario |
| Sin rutas admin/debug expuestas | 9b (D32) + Admin Center con RBP y MFA | Cumple: CI revisa el build de producción y falla si alguna ruta tiene un segmento de debug o de pruebas (debug, test, dev, playground, sandbox, mock, e2e, seed…) o si hay source maps del navegador; Admin Center exige `can()` y AAL2 |
| Rendimiento bajo carga (k6, p95 < 500 ms) | 9b (D34–D38) + 23 (réplicas de web) | Cumple en local con el modelo de carga de D36: 1,000 usuarios en un tenant y 50 en cada uno de otros tres al mismo tiempo, con 20–40 s entre páginas: p95 217 ms, p99 360 ms, 0 % de fallos. Un proceso web sirve unas 40 páginas/s con p95 < 500 ms (unos 180 usuarios con 2–6 s entre páginas); más allá se escala con réplicas en la Fase 23. Listados paginados y búsqueda de personas en lugar de listas del tenant completo (D38); pool de Prisma explícito (D37). CI corre una versión corta en cada PR |
| Logging y monitoreo | 9a (`/api/health`) + 9b (logs JSON, D27) + 23 (Sentry) | Parcial: `/api/health` y el HEALTHCHECK de las imágenes existen (D17); web y worker escriben logs JSON con request id, tenant id y redacción de datos sensibles, y los errores pasan por un adaptador de reporte (D27), probado con un error forzado. Faltan Sentry en el mismo adaptador y uptime (23) |
| Bitácora inmutable y sin datos sensibles | 9b + 11 | Parcial: solo se escribe vía `write_audit_log`, UPDATE/DELETE están bloqueados por políticas RESTRICTIVE y TRUNCATE quedó revocado (D25), con tests desde la Data API y desde una conexión de la app; los logs de la app redactan contraseñas, tokens, CURP, RFC, NSS, CLABE y salario (D27). Los `diff` de la bitácora guardan los valores cambiados (salario, datos personales) como registro del cambio; su enmascaramiento para quien los lee va con los datos sensibles de la Fase 11. `anonymize_user` (D10) reemplaza datos personales por ARCO. Desde D28 el login y la verificación MFA se auditan desde el servidor y los logins fallidos quedan en los logs JSON |
| Credenciales demo fuera de producción | 9c (D41) + 23 (sin datos demo) | Cumple en local: el login muestra una pista solo si la variable del servidor `SCALIA_DEMO_LOGIN_HINT` la trae (nunca `NEXT_PUBLIC_`), y se ignora en producción si `APP_BASE_URL` no es local; `check:prod-build` falla si el bundle del cliente contiene la contraseña o el correo demo, y CI revisa el `/login` de la imagen. Pendiente para la Fase 23: sacar los datos demo de las migraciones y ninguna credencial demo en pantalla |
| Uploads seguros (SVG, logos, íconos) | 11 | Pendiente: hoy no hay uploads |
| Datos sensibles enmascarados | 11 | Pendiente: CURP, RFC y salario se muestran completos a quien pasa RLS (D6); NSS y CLABE llegan en la Fase 14 |
| WCAG 2.2 AA (contraste, teclado, zoom, táctil) | 9c (D40, D41, D42 y PRs siguientes) + validación de colores en 11 | Parcial: desde D40 todo color es un token y una prueba revisa sus 121 pares por modo (texto 4.5:1, bordes de controles, foco e indicadores 3:1) en claro, oscuro y alto contraste (7:1 y 4.5:1); el texto terciario y los placeholders también cumplen 4.5:1. Un test estático impide colores literales en los componentes. Foco visible global con el token `focus`. Desde D41: `lang="es-MX"`, enlace para saltar al contenido, navegación con `aria-current`, diálogo "Más" modal con foco atrapado y Esc, tooltips del rail con foco de teclado y Esc, áreas táctiles de 44 px en la navegación, sin scroll horizontal a 320 px (1.4.10) y foco nunca oculto bajo el dock o el header (2.4.11), medidos en la imagen de producción. Desde D42 (3.1.1): textos de la UI en español con el `lang="es-MX"`, estados de la base traducidos y fechas en es-MX; un test estático falla si vuelve un texto en inglés conocido. Faltan zoom al 200 % en todas las pantallas, la biblioteca base y axe en CI (PRs siguientes de la 9c) |
| Movimiento reducido | 9c | Parcial: las duraciones de transición son tokens que pasan a 0 con `prefers-reduced-motion: reduce` (D40). Faltan framer-motion con `useReducedMotion` y la animación del indicador de carga |
| LFPDPPP 2025: aviso de privacidad | 11 (DPCS visible en todos los temas) | Pendiente: DPCS todavía no existe |
| LFPDPPP 2025: derechos ARCO | 20 | Parcial: el admin procesa solicitudes y la supresión existe (D10); faltan autoservicio y bloqueo (Known Risk registrado) |
| Licencias de fuentes e íconos | 9c (D40) + 11 (OFL, Lucide/Phosphor/Tabler) | Parcial: Inter (SIL OFL 1.1) autohospedada con su licencia en `src/fonts/inter/OFL.txt`, origen y SHA-256 documentados; los presets solo eligen fuentes de una lista cerrada. Faltan los paquetes de íconos (Fase 11) |
| Theme Manager usable por administradores sin experiencia técnica | 9c (base, D40) + 11 | Pendiente: la base existe desde D40 (presets como datos, alto contraste derivado, `themeCss()` que valida cada valor y `ensureContrast()` para ajustar colores); el asistente y los 5 presets restantes llegan en la Fase 11 |
| Aislamiento de tenant por subdominio o código de empresa | 9a (D21) + 9b (D34, D35) + 23 (dominio real) | Cumple en local: el middleware solo deja pasar al tenant del token y activo; otro tenant, uno inexistente y uno suspendido reciben el mismo 404, y los anónimos la misma redirección al login. Un tenant suspendido sale de los tokens nuevos (hook). Probado con el middleware real contra Supabase local. Desde D35 el middleware recuerda 5 s un par permitido (tenant pedido, tenant del token), así que un tenant suspendido queda fuera a más tardar 5 s después; los rechazos nunca se guardan. Las cachés entre peticiones llevan el tenant del token en la llave y el RBP no se cachea entre peticiones. La prueba de carga revisa en cada página que no aparezcan empleados de otro tenant (D36) |
| Correo transaccional | 9a (D20) + 23 (Resend, SPF/DKIM/DMARC) | Cumple en local: el worker envía por el adaptador SMTP a Mailpit; enlaces solo al dominio de la app y sus subdominios; marca validada (logo `http(s)`, color con contraste 4.5:1); sin direcciones en los logs; trabajos borrados al día. Cada plantilla se prueba en Mailpit |
| Migraciones seguras en producción | 9a (D7, D22) + 23 (staging → producción) | Cumple en local: el modo producción de db-remote-sync solo aplica migraciones pendientes, en orden y sin reparar el historial; reset y repair-push se rechazan para producción y en cualquier base con la marca de producción, antes de tocarla. Probado contra Supabase local, sin proyectos remotos. La regla expand/contract está documentada (D22); hoy se revisa a mano en cada PR |
| Respaldos y restauración | 9a local (D23, D24) + 23 producción | Cumple en local: export por tenant ejecutado por el worker (solo filas de ese tenant, SHA-256 y versión de esquema), restauración por tenant sin tocar a los demás y respaldo completo restaurable en sitio en una transacción, probados en CI contra Supabase local; runbook en `docs/RUNBOOK.md`. Los respaldos tienen datos personales: quedan fuera de git y de las imágenes. Pendiente para la Fase 23: respaldos diarios y PITR del plan Pro, exports diarios a almacenamiento cifrado y restauración sobre bases hospedadas |

---

## Principios

1. **TIH es la capa de skills de la plataforma.** Todas las competencias, habilidades y atributos se gestionan en Talent Intelligence Hub. JPB depende de TIH para su catálogo de atributos.

2. **TIH y JPB alimentan todo el talento.** PMGM, LMS, RCM, SDM y todos los módulos de talento consumen la ontología de skills y los perfiles de puesto definidos en TIH/JPB.

3. **Metas de desempeño y metas de desarrollo son planes separados.** Las metas de desempeño (PMGM) evalúan resultados del rol actual; las metas de desarrollo (Career Development) trazan el crecimiento hacia un rol objetivo. Nunca se mezclan en el mismo plan.

4. **Todo es configurable en Admin Center.** Cada módulo expone su configuración (plantillas, escalas, picklists, políticas) a través de Admin Center, sin necesidad de cambios en código.

5. **Versionado y transportable entre tenants.** Las configuraciones se versionan y pueden exportarse/importarse entre tenants (transport packages) para facilitar pruebas y despliegue multi-entorno.

6. **Plantillas de formulario inmutables una vez lanzadas.** Las plantillas de PMGM y 360 se manejan con import/export. Una vez que una plantilla se lanza (asociada a un ciclo activo), su versión queda fija; los cambios posteriores crean una nueva versión que aplica a ciclos futuros.

7. **Producción primero.** Ningún módulo nuevo sale a clientes sin pasar por staging, con rate limiting, monitoreo y respaldos activos.

8. **Sin inversión hasta tener el producto completo.** Todo se desarrolla y prueba en local (Docker + Supabase local). Los servicios de pago se integran por adaptador, con una implementación local o de prueba, y se contratan solo en la Fase 23, cuando las fases 9a–22 están completas y probadas al 100 % en local. Hasta entonces no hay clientes ni staging; el Principio 7 rige desde el lanzamiento de la Fase 23.
