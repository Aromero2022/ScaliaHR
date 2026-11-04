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
| 9a | Infraestructura local | Completada (PR #45, #48, #49 y PR4_NUMBER; criterio de cierre verificado abajo) |

---

## Fases planificadas

| Fase | Nombre | Alcance |
|------|--------|---------|
| 9a | Infraestructura local (completada) | Dockerfile, /api/health, worker pg-boss en docker-compose, lib/email con React Email probado en Mailpit, middleware de tenant con *.localhost, db-remote-sync con reset bloqueado, export por tenant, prueba de restauración local y runbook. Todo corre gratis en local. |
| 9b | Seguridad y rendimiento local | Rate limiting activo, CSP sin unsafe-eval, server-only, caching por tenant, índices, paginación, logs estructurados en JSON, prueba de carga k6 contra Docker, Dependabot y escaneo de secretos. Errores genéricos con request id, sin rutas de debug, redacción de datos sensibles en logs, bitácora de solo inserción y zod en todas las Server Actions. |
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

**Estado: completada** (PR #45, #48, #49 y PR4_NUMBER). Cada punto del criterio se prueba en CI en cada PR:

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

---

## Fase 9c — Sistema de diseño y responsividad

Base visual y de interacción sobre la que se construyen todos los módulos desde la Fase 10. Corre en local, sin servicios de pago (Principio 8). Decisión de arquitectura: D19.

### Design tokens

- Design tokens como variables CSS: color, tipografía, espaciado en múltiplos de 4, radios y sombras. Tailwind consume los tokens.
- Espaciado de formularios: label→input 8px, input→ayuda 4px, entre campos 20px, entre secciones 24px.

### Layout y navegación

- Layout Holy Grail / Two Column.
- Navegación: sidebar completo colapsable en escritorio, riel de íconos en tablet y dock inferior de máximo 5 íconos con texto en móvil.
- Búsqueda global con ⌘K.

### Responsive

- Grid con auto-fit, clamp() con texto de cuerpo mínimo 16px, container queries para widgets, min(100% - 2rem, 65ch) en textos largos, flex-wrap + gap en chips y aspect-ratio en fotos y video.
- Dashboard de 1 a 4 columnas; tablas que se vuelven tarjetas en móvil; formularios largos por pasos.

### Reglas UX

- Un solo botón primario por pantalla.
- Áreas táctiles de 44px.
- Skeletons en cargas mayores a 400 ms.
- Menús que solo muestran módulos contratados (D12) y permitidos por rol (RBP). El sidebar actual ya filtra por flag de módulo y por `can()` (D14); el riel y el dock usan el mismo filtro.

### Accesibilidad (WCAG 2.2 AA)

- Labels visibles (nunca solo placeholder).
- Foco visible.
- Navegación completa con teclado.
- Zoom al 200 % sin romper el layout.
- prefers-reduced-motion respetado (framer-motion con useReducedMotion). framer-motion todavía no está en el repo; se agrega en esta fase.

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

---

## Fase 11 — Admin Center base

CRUD de RBP (roles, grupos y asignaciones), DPCS (aviso de privacidad versionado, aceptación al iniciar sesión y Set DPCS Statement Status), Picklist Center, Import Employee Data, configuración de empresa (logo, tema, idioma, política de contraseña y MFA), reporte de auditoría, política de login por cliente (correo, número de empleado o ambos) y reseteo de contraseña por RH.

- Al habilitar roles personalizados, `insert_effective_record` (y cualquier función de la base que hoy autorice por `app_role`) debe validar el permiso RBP en lugar del rol fijo.
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

---

## Fase 12 — Consola de plataforma y suscripciones

Catálogo de planes y módulos, alta de clientes por autoservicio con periodo de prueba y alta asistida, activación y suspensión por pago, facturación por adaptador (local/prueba). Consola del proveedor separada del Admin Center del cliente. Subdominio o código de empresa por tenant. Acceso de soporte del proveedor (temporal, auditado, autorizado por el cliente).

- Acceso de soporte del proveedor otorgado por el cliente desde Admin Center, temporal, solo lectura por defecto, con break-glass con motivo obligatorio, banner "Modo soporte", MFA obligatorio y registro en la bitácora del cliente.
- Tenants sandbox ligados al tenant de producción, con refresh y datos anonimizados (LFPDPPP).
- Canales de release con flags (universales, opt-in, por módulo D12) y clientes preview.
- Conversión de demo a cliente con licencia: activa el export por tenant y los compromisos de RPO/RTO del contrato.
- Facturación y cobro por adaptador (local/prueba): la activación y suspensión por pago se prueban con la implementación de prueba; el proveedor real se contrata en la Fase 23.

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
- Entrevista de salida y transferencia de conocimiento.
- Datos de finiquito hacia nómina vía API; integración con nómina por adaptador (local/prueba).
- Tarea de baja en IMSS.
- Elegibilidad de recontratación.
- Al cerrar, aplica la política de retención de DRTM (Fase 20).

**Criterio de cierre:** un alta completa desde preboarding hasta el día 1 y una baja con revocación de accesos verificada, ambas con su bitácora de auditoría.

---

## Fase 23 — Lanzamiento a producción

Única fase en la que se contratan servicios de pago (Principio 8). Conecta los proveedores reales detrás de los adaptadores ya probados en local; no agrega funcionalidad de producto.

### Requisito de entrada (antes del primer cliente)

- Fases 9a–22 completas y probadas al 100 % en local.
- Cambiar el factor MFA del owner.
- Sacar los datos demo de las migraciones a seed.sql.
- `can()` como función SECURITY DEFINER en la base.
- Verificar la bitácora de auditoría: **parcialmente resuelto** (PR #42). Login (`AUTH_LOGIN`), MFA (`MFA_ENROLL`, `MFA_VERIFY`, `MFA_ENROLL_FAILED`, `MFA_VERIFY_FAILED`) ya se registran y Admin Center los muestra con `entity`, `entity_id` y `diff`. Pendiente: cambios de permisos (Fase 11 CRUD de RBP) y logins fallidos/directos (Known Risk "Login Audit Depends on the Client" en ARCHITECTURE.md, fix planeado junto con rate limiting de Fase 9b).
- Cerrar los Known Risks de ARCHITECTURE.md.

### Dominio y CDN

- app.scaliahr.com y subdominios por tenant (<cliente>.scaliahr.com) con SSL comodín.
- Assets con cache inmutable y CDN (Cloudflare) delante de Railway.

### Ambientes

- Dos proyectos de Supabase en plan Pro: staging y producción. Las migraciones se validan en staging y se promueven a producción con el modo producción de db-remote-sync (solo aplica migraciones; reset bloqueado, Fase 9a).
- Dos ambientes en Railway (staging y producción), cada uno con sus propias variables y secretos. Ninguna llave de producción vive en staging ni en el repo.
- Worker como servicio separado en Railway, con la misma imagen probada en docker-compose (Fase 9a).
- Réplicas horizontales configuradas en Railway.
- Límites nativos de Supabase Auth (Fase 9b) activados también en staging y producción.
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

> Estados verificados contra el código y la base local de main (commit 0a3c70f) el 2026-11-04, revisados de nuevo con main en 62ea0cc (PR #45, Fase 9a PR 1), con main en 5908222 (PR #48, Fase 9a PR 2: correo y tenant por subdominio, D20 y D21), con main en 3ca8d5d (PR #49, Fase 9a PR 3: migraciones seguras, D22) y con la rama del PR 4 de la Fase 9a (respaldos y runbook, D23 y D24). Cada fase, al cerrarse, actualiza el estado de sus filas.

| Norma o control | Dónde se cumple | Estado |
|-----------------|-----------------|--------|
| RLS por tenant | Todas las tablas + D3 (Prisma sin bypass) + D6 + D17 (`pgboss`) + D20 (`email_enqueuer`) + D22 (`ops`); TRUNCATE en 9b | Cumple: las 38 tablas de `public`, las 11 de `pgboss` y la de `ops` tienen ENABLE + FORCE RLS y ningún rol de la app (incluidos `worker_app` y `email_enqueuer`) tiene BYPASSRLS. `email_enqueuer` solo inserta trabajos de `email.send` y no lee su contenido; `worker_app` lee la marca del tenant solo a través de `email_branding()`. Brecha: `anon`, `authenticated` y `prisma_app` conservan TRUNCATE (ignora RLS) en 37 tablas de `public`; se revoca en 9b. En `pgboss` nadie tiene TRUNCATE |
| Secretos fuera del cliente y del repo | .env fuera del repo + D4 + D17 (`.dockerignore`, `.env.docker` ignorado e imágenes revisadas en CI) + D20 (`EMAIL_ENQUEUE_DATABASE_URL` solo en el servidor); server-only en 9b | Cumple, se refuerza en 9b |
| Rate limiting (429) | 9b | Pendiente: el código existe, falta conectarlo |
| CSP estricta | 9b | Pendiente: la CSP todavía permite 'unsafe-inline' y 'unsafe-eval' en scripts |
| Validación de entradas (zod) | 9b | Parcial: ARCO, empleados, skills-hub, `createTenant`, los trabajos de correo (al encolar y en el worker, D20), el código de empresa y la configuración del worker (D21) validan con zod; faltan `performance/actions.ts` y `lib/tenant/actions.ts` |
| Errores sin exponer detalles | 9b | Pendiente: 16 respuestas de Server Actions devuelven `error.message` de la base y no hay `error.tsx`. `/api/health` (D17) y el 404 de tenant (D21) ya responden sin detalles |
| Sin rutas admin/debug expuestas | 9b + Admin Center con RBP y MFA | Parcial: no hay rutas de debug y Admin Center ya exige `can()` y AAL2; falta el test de 9b sobre el build de producción |
| Logging y monitoreo | 9a (`/api/health`) + 9b (logs JSON) + 23 (Sentry) | Parcial: `/api/health` y el HEALTHCHECK de las imágenes existen (D17); faltan logs JSON (9b) y Sentry y uptime (23) |
| Bitácora inmutable y sin datos sensibles | 9b | Parcial: solo se escribe vía `write_audit_log` y UPDATE/DELETE están bloqueados por políticas RESTRICTIVE; faltan revocar TRUNCATE y redactar datos sensibles. `anonymize_user` (D10) reemplaza datos personales por ARCO |
| Uploads seguros (SVG, logos, íconos) | 11 | Pendiente: hoy no hay uploads |
| Datos sensibles enmascarados | 11 | Pendiente: CURP, RFC y salario se muestran completos a quien pasa RLS (D6); NSS y CLABE llegan en la Fase 14 |
| WCAG 2.2 AA (contraste, teclado, zoom, táctil) | 9c + validación de colores en 11 | Pendiente |
| Movimiento reducido | 9c | Pendiente |
| LFPDPPP 2025: aviso de privacidad | 11 (DPCS visible en todos los temas) | Pendiente: DPCS todavía no existe |
| LFPDPPP 2025: derechos ARCO | 20 | Parcial: el admin procesa solicitudes y la supresión existe (D10); faltan autoservicio y bloqueo (Known Risk registrado) |
| Licencias de fuentes e íconos | 11 (OFL, Lucide/Phosphor/Tabler) | Pendiente: hoy no hay paquetes de fuentes ni de íconos |
| Theme Manager usable por administradores sin experiencia técnica | 11 | Pendiente |
| Aislamiento de tenant por subdominio o código de empresa | 9a (D21) + 23 (dominio real) | Cumple en local: el middleware solo deja pasar al tenant del token y activo; otro tenant, uno inexistente y uno suspendido reciben el mismo 404, y los anónimos la misma redirección al login. Un tenant suspendido sale de los tokens nuevos (hook). Probado con el middleware real contra Supabase local |
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
