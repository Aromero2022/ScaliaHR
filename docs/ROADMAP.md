# Scalia HR — Roadmap

> **Nota:** El cierre de autorización (D12 — licenciamiento por módulo, `can()`
> en todas las rutas y acciones, caché por request, guards de flag de módulo y
> permisos completos en create-tenant) se ejecuta antes de la Fase 9a como
> prerrequisito de seguridad para todas las fases siguientes.

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

---

## Fases planificadas

| Fase | Nombre | Alcance |
|------|--------|---------|
| 9a | Infraestructura y despliegue | Ambientes staging/producción (Supabase + Railway), CI/CD, Dockerfile, worker, dominios, correo transaccional (Resend) y respaldos. |
| 9b | Seguridad, rendimiento y observabilidad | Rate limiting activo, CSP sin unsafe-eval, caching por tenant, prueba de carga k6, Sentry, logs estructurados y alertas. |
| 10 | Workflows y Notificaciones | Motor de workflows configurable, notificaciones push/email/in-app, eventos de ciclo de vida del empleado. Consume el correo y worker de la Fase 9a. |
| 11 | Admin Center base | CRUD de RBP, DPCS, Picklist Center, Import Employee Data, configuración de empresa, reporte de auditoría, política de login y reseteo de contraseña por RH. |
| 12 | Consola de plataforma y suscripciones | Catálogo de planes, alta de clientes, facturación, consola del proveedor, acceso de soporte, tenants sandbox, canales de release y conversión demo → cliente. |
| 13 | API pública e integraciones | API REST versionada, API keys, OAuth2, webhooks salientes, documentación OpenAPI. |
| 14 | Onboarding y Offboarding | Alta y preboarding, captura de datos fiscales, firma electrónica, tareas por responsable, offboarding con revocación de accesos. |
| 15 | JPB + realineación de TIH | Job Profile Builder: biblioteca de atributos, escalas, tags, Growth Portfolio. Realineación de TIH como capa de skills. |
| 16 | PMGM v2 | Plantillas de formulario, rating scales, route maps, metas de desempeño. |
| 17 | 360 Multi-Rater | Evaluaciones multi-evaluador con formularios configurables y anonimato parcial. |
| 18a | Calibración y Sucesión | Calibración, performance vs. potencial, 9-box, talent pools, sucesión y organigrama de sucesión. |
| 18b | Career Development y mentoring | Metas de desarrollo, Career Worksheet, rol objetivo, mentoring. |
| 19 | CPM y Feedback Continuo | Continuous Performance Management: check-ins periódicos y feedback continuo. |
| 20 | Retención y Bloqueo (DRTM) + autoservicio ARCO | Data Retention & Transparency Module, incluido el autoservicio ARCO. |
| 21 | Time Tracking | Registro de tiempo, aprobaciones, integración con nómina. Consume la API de la Fase 13. |
| 22 | RCM | Recruiting Management: requisiciones, candidatos, pipeline y ofertas. Al contratar un candidato, inicia el Onboarding de la Fase 14. |

---

## Fase 9a — Infraestructura y despliegue

### Ambientes

- Dos proyectos de Supabase: staging y producción. Las migraciones se validan en staging y se promueven a producción con db-remote-sync en un modo producción que solo aplica migraciones; el modo reset queda bloqueado para producción (coherente con D7). Migraciones compatibles hacia atrás (expand/contract).
- Dos ambientes en Railway (staging y producción), cada uno con sus propias variables y secretos. Ninguna llave de producción vive en staging ni en el repo.
- Preview por Pull Request contra Supabase staging.

### Despliegue

- Dockerfile multi-etapa con output: "standalone", Node 22 LTS, usuario no root y turbo prune @scaliahr/web.
- main despliega a staging; un tag o release despliega a producción. El CI actual es requisito para desplegar.
- Health check /api/health que valida la app y la conexión a la base de datos.
- Rollback documentado en un runbook.

### Worker en segundo plano

- Servicio separado en Railway para correos, workflows, jobs programados, exports por tenant e integraciones.
- Cola persistente en Postgres (pg-boss o equivalente) con reintentos, backoff y cola de errores (dead letter).

### Dominios

- app.scaliahr.com y subdominios por tenant (<cliente>.scaliahr.com) con SSL comodín.
- Middleware que resuelve el tenant por subdominio o por código de empresa.

### Correo transaccional (Resend)

- Dominio de envío verificado con SPF, DKIM y DMARC.
- Resend como SMTP personalizado en Supabase Auth: invitaciones, confirmación de cuenta y reseteo de contraseña.
- Módulo lib/email con plantillas React Email, multi-idioma y con la marca de cada tenant.
- Webhooks de Resend que alimentan una bitácora de envío por tenant (enviado, entregado, rebotado, queja).
- API keys separadas por ambiente; staging solo envía a correos de prueba.

### Respaldos

- Respaldo diario del plan Pro desde que exista el proyecto de producción.
- Point-in-Time Recovery: diferido; se contrata al dar de alta el primer cliente facturable (antes no). Cubre todo el proyecto de producción.
- Export lógico por tenant ejecutado por el worker, diario, solo para tenants con licencia activa (se enciende al convertir una demo en cliente), restaurable sin afectar a los demás tenants.
- Tenants demo/prueba: sin RPO comprometido; sus términos lo indican.
- RPO y RTO por escrito para clientes con licencia, incluidos en el contrato.
- Prueba de restauración mensual documentada (completa y por tenant).

**Criterio de cierre:** ambos ambientes operando, despliegue continuo funcionando, un correo real enviado desde cada ambiente y una restauración probada (completa y por tenant).

---

## Fase 9b — Seguridad, rendimiento y observabilidad

### Rate limiting

`lib/rate-limit.ts` y `check_rate_limit` ya existen, pero no se usan en ningún flujo.

- Conectarlo en login, MFA, reseteo de contraseña, alta de tenant, Server Actions de escritura y la API pública.
- Hacerlo fail-closed en login y MFA: hoy, si la RPC falla, deja pasar la petición.
- Permitir que la RPC funcione sin sesión, porque el login ocurre antes de autenticarse.
- Llave de límite por IP + tenant + usuario; responder 429 con Retry-After.
- Límites configurables por tenant desde Admin Center.
- Activar también los límites nativos de Supabase Auth.

### Endurecimiento

- Quitar 'unsafe-eval' de la CSP y reemplazar 'unsafe-inline' en scripts por nonces.
- Poner productionBrowserSourceMaps: false de forma explícita.
- Proteger las llaves privadas con server-only y una regla de lint que impida importarlas en componentes cliente.
- Dependabot y escaneo de secretos en CI.
- Dejar en cero los advisors de seguridad y rendimiento de Supabase.

### Caching

- unstable_cache con tags por tenant para picklists, configuración de empresa, tema y catálogos de TIH/JPB; invalidar al guardar desde Admin Center.
- Caché de RBP entre peticiones: hoy no existe (D14: contexto de permisos solo por petición). Si algún día se agrega, la llave debe incluir tenant_id y debe invalidarse en cada cambio de role_grants, group_members o permisos, con un test que demuestre que un permiso revocado deja de valer de inmediato.
- Assets con cache inmutable y CDN (Cloudflare) delante de Railway.
- Interfaz de caché lista para cambiar a Redis.

### Escalabilidad

- Prisma por el pooler (transaction mode) con límites de conexión definidos.
- Revisar índices sobre tenant_id y fechas efectivas; paginación obligatoria en listados.
- Prueba de carga con k6 en staging: 1,000 usuarios concurrentes en un tenant y varios tenants a la vez; objetivo p95 < 500 ms.
- Réplicas horizontales configuradas en Railway.

### Observabilidad

- Sentry en web y worker, con releases ligados al despliegue.
- Logs estructurados en JSON con request id y tenant id.
- Uptime monitoring sobre /api/health con alertas a correo o Slack.
- Panel de métricas: errores, latencia, jobs fallidos, correos rebotados y eventos de rate limiting.

**Criterio de cierre:** prueba de carga aprobada, rate limiting activo y probado, CSP sin unsafe-eval y alertas llegando ante un error forzado.

---

## Fase 10 — Workflows y Notificaciones

Motor de workflows configurable, notificaciones push/email/in-app, eventos de ciclo de vida del empleado. Consume el canal de correo y el worker de la Fase 9a.

- Preferencias de notificación por usuario y opción de desuscribirse de correos no críticos.

---

## Fase 11 — Admin Center base

CRUD de RBP (roles, grupos y asignaciones), DPCS (aviso de privacidad versionado, aceptación al iniciar sesión y Set DPCS Statement Status), Picklist Center, Import Employee Data, configuración de empresa (logo, tema, idioma, política de contraseña y MFA), reporte de auditoría, política de login por cliente (correo, número de empleado o ambos) y reseteo de contraseña por RH.

- Al habilitar roles personalizados, `insert_effective_record` (y cualquier función de la base que hoy autorice por `app_role`) debe validar el permiso RBP en lugar del rol fijo.

---

## Fase 12 — Consola de plataforma y suscripciones

Catálogo de planes y módulos, alta de clientes por autoservicio con periodo de prueba y alta asistida, activación y suspensión por pago, facturación. Consola del proveedor separada del Admin Center del cliente. Subdominio o código de empresa por tenant. Acceso de soporte del proveedor (temporal, auditado, autorizado por el cliente).

- Acceso de soporte del proveedor otorgado por el cliente desde Admin Center, temporal, solo lectura por defecto, con break-glass con motivo obligatorio, banner "Modo soporte", MFA obligatorio y registro en la bitácora del cliente.
- Tenants sandbox ligados al tenant de producción, con refresh y datos anonimizados (LFPDPPP).
- Canales de release con flags (universales, opt-in, por módulo D12) y clientes preview.
- Conversión de demo a cliente con licencia: activa el export por tenant y los compromisos de RPO/RTO del contrato.

---

## Fase 13 — API pública e integraciones

- API REST versionada (/api/v1) con aislamiento por tenant y permisos según RBP.
- API keys y OAuth2 client credentials que se crean, rotan y revocan desde Admin Center.
- Rate limiting por llave, auditoría de cada llamada y paginación estándar.
- Webhooks salientes firmados y con reintentos (alta, baja, cambio de puesto, aprobación de workflow).
- Documentación OpenAPI y colección de Postman.
- Primeras entidades: empleados, organización/posiciones, ausencias y tiempo.

---

## Fase 14 — Onboarding y Offboarding

Depende de: Workflows (10), Admin Center (11), worker y Resend (9a), API (13). No depende de RCM.

### Onboarding

- Alta del nuevo ingreso en EC con fecha efectiva.
- Preboarding: portal antes del día 1 con acceso temporal.
- Captura de datos personales y fiscales (RFC, CURP, NSS, CLABE) con permisos por campo (PII sensible).
- Documentos y firma electrónica (contrato, aviso de privacidad, NDA).
- Tareas por responsable (RH, manager, TI, buddy) con plantillas por puesto o ubicación, configurables en Admin Center.
- Asignación automática de cursos LMS y metas iniciales.
- Encuestas a 30/60/90 días.
- Tarea de alta en IMSS.

### Offboarding

- Baja en EC con motivo y fecha efectiva.
- Tareas de devolución de equipo y revocación de accesos (sesiones, LMS, integraciones).
- Entrevista de salida y transferencia de conocimiento.
- Datos de finiquito hacia nómina vía API.
- Tarea de baja en IMSS.
- Elegibilidad de recontratación.
- Al cerrar, aplica la política de retención de DRTM (Fase 20).

**Criterio de cierre:** un alta completa desde preboarding hasta el día 1 y una baja con revocación de accesos verificada, ambas con su bitácora de auditoría.

---

## Antes del primer cliente

- Cambiar el factor MFA del owner.
- Sacar los datos demo de las migraciones a seed.sql.
- `can()` como función SECURITY DEFINER en la base.
- Verificar la bitácora de auditoría: hoy Admin Center muestra "Sin entradas de auditoría" aunque login, MFA y cambios de permisos debían registrarse desde la Fase 3. Confirmar si no se escriben o si la vista no las lee, y corregirlo con test.
- Cerrar los Known Risks de ARCHITECTURE.md.
- Completar las Fases 9a y 9b.
- Al dar de alta el primer cliente facturable: contratar PITR y encender su export por tenant.

---

## Principios

1. **TIH es la capa de skills de la plataforma.** Todas las competencias, habilidades y atributos se gestionan en Talent Intelligence Hub. JPB depende de TIH para su catálogo de atributos.

2. **TIH y JPB alimentan todo el talento.** PMGM, LMS, RCM, SDM y todos los módulos de talento consumen la ontología de skills y los perfiles de puesto definidos en TIH/JPB.

3. **Metas de desempeño y metas de desarrollo son planes separados.** Las metas de desempeño (PMGM) evalúan resultados del rol actual; las metas de desarrollo (Career Development) trazan el crecimiento hacia un rol objetivo. Nunca se mezclan en el mismo plan.

4. **Todo es configurable en Admin Center.** Cada módulo expone su configuración (plantillas, escalas, picklists, políticas) a través de Admin Center, sin necesidad de cambios en código.

5. **Versionado y transportable entre tenants.** Las configuraciones se versionan y pueden exportarse/importarse entre tenants (transport packages) para facilitar pruebas y despliegue multi-entorno.

6. **Plantillas de formulario inmutables una vez lanzadas.** Las plantillas de PMGM y 360 se manejan con import/export. Una vez que una plantilla se lanza (asociada a un ciclo activo), su versión queda fija; los cambios posteriores crean una nueva versión que aplica a ciclos futuros.

7. **Producción primero.** Ningún módulo nuevo sale a clientes sin pasar por staging, con rate limiting, monitoreo y respaldos activos.
