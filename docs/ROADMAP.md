# Scalia HR — Roadmap

> Fases planificadas a partir del estado actual (Fases 1–8 completadas).
>
> **Nota:** El cierre de autorización (D12 — licenciamiento por módulo, `can()`
> en todas las rutas y acciones, caché por request, guards de flag de módulo y
> permisos completos en create-tenant) se ejecuta antes de la Fase 9 como
> prerrequisito de seguridad para todas las fases siguientes.

---

## Fases

| Fase | Nombre | Alcance |
|------|--------|---------|
| 9 | Workflows y Notificaciones | Motor de workflows configurable, notificaciones push/email/in-app, eventos de ciclo de vida del empleado. |
| 10 | Admin Center base | CRUD de RBP (roles, grupos y asignaciones), DPCS (aviso de privacidad versionado, aceptación al iniciar sesión y Set DPCS Statement Status), Picklist Center, Import Employee Data, configuración de empresa (logo, tema, idioma, política de contraseña y MFA), reporte de auditoría, política de login por cliente (correo, número de empleado o ambos) y reseteo de contraseña por RH. |
| 11 | Consola de plataforma y suscripciones | Catálogo de planes y módulos, alta de clientes por autoservicio con periodo de prueba y alta asistida, activación y suspensión por pago, facturación. Consola del proveedor separada del Admin Center del cliente. Subdominio o código de empresa por tenant. Acceso de soporte del proveedor (temporal, auditado, autorizado por el cliente). |
| 12 | JPB + realineación de TIH | Job Profile Builder: biblioteca de atributos, escalas, tags, Growth Portfolio. Realineación de TIH como capa de skills. |
| 13 | PMGM v2 | Plantillas de formulario, rating scales, route maps, metas de desempeño. |
| 14 | 360 Multi-Rater | Evaluaciones multi-evaluador con formularios configurables y anonimato parcial. |
| 15a | Calibración y Sucesión | Calibración, performance vs. potencial, 9-box, talent pools, sucesión y organigrama de sucesión. |
| 15b | Career Development | Metas de desarrollo, Career Worksheet, rol objetivo, mentoring. |
| 16 | CPM y Feedback Continuo | Continuous Performance Management: check-ins periódicos y feedback continuo. |
| 17 | Retención y Bloqueo (DRTM) | Data Retention & Transparency Module, incluido el autoservicio ARCO. |
| 18 | Time Tracking | Registro de tiempo, aprobaciones, integración con nómina. |
| 19 | RCM | Recruiting Management: requisiciones, candidatos, pipeline y ofertas. |

---

## Principios

1. **TIH es la capa de skills de la plataforma.** Todas las competencias, habilidades y atributos se gestionan en Talent Intelligence Hub. JPB depende de TIH para su catálogo de atributos.

2. **TIH y JPB alimentan todo el talento.** PMGM, LMS, RCM, SDM y todos los módulos de talento consumen la ontología de skills y los perfiles de puesto definidos en TIH/JPB.

3. **Metas de desempeño y metas de desarrollo son planes separados.** Las metas de desempeño (PMGM) evalúan resultados del rol actual; las metas de desarrollo (Career Development) trazan el crecimiento hacia un rol objetivo. Nunca se mezclan en el mismo plan.

4. **Todo es configurable en Admin Center.** Cada módulo expone su configuración (plantillas, escalas, picklists, políticas) a través de Admin Center, sin necesidad de cambios en código.

5. **Versionado y transportable entre tenants.** Las configuraciones se versionan y pueden exportarse/importarse entre tenants (transport packages) para facilitar pruebas y despliegue multi-entorno.

6. **Plantillas de formulario inmutables una vez lanzadas.** Las plantillas de PMGM y 360 se manejan con import/export. Una vez que una plantilla se lanza (asociada a un ciclo activo), su versión queda fija; los cambios posteriores crean una nueva versión que aplica a ciclos futuros.
