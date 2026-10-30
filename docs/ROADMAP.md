# Scalia HR — Roadmap

> Fases planificadas a partir del estado actual (Fases 1–8 completadas).

---

## Fases

| Fase | Nombre | Alcance |
|------|--------|---------|
| 9 | Workflows y Notificaciones | Motor de workflows configurable, notificaciones push/email/in-app, eventos de ciclo de vida del empleado. |
| 10 | Admin Center base | CRUD de RBP (roles, grupos y asignaciones), DPCS (aviso de privacidad versionado, aceptación al iniciar sesión y Set DPCS Statement Status), Picklist Center, Import Employee Data, configuración de empresa (logo, tema, idioma, política de contraseña y MFA) y reporte de auditoría. |
| 11 | JPB + realineación de TIH | Job Profile Builder: biblioteca de atributos, escalas, tags, Growth Portfolio. Realineación de TIH como capa de skills. |
| 12 | PMGM v2 | Plantillas de formulario, rating scales, route maps, metas de desempeño. |
| 13 | 360 Multi-Rater | Evaluaciones multi-evaluador con formularios configurables y anonimato parcial. |
| 14a | Calibración y Sucesión | Calibración, performance vs. potencial, 9-box, talent pools, sucesión y organigrama de sucesión. |
| 14b | Career Development | Metas de desarrollo, Career Worksheet, rol objetivo, mentoring. |
| 15 | CPM y Feedback Continuo | Continuous Performance Management: check-ins periódicos y feedback continuo. |
| 16 | Retención y Bloqueo (DRTM) | Data Retention & Transparency Module, incluido el autoservicio ARCO. |
| 17 | Time Tracking | Registro de tiempo, aprobaciones, integración con nómina. |
| 18 | RCM | Recruiting Management: requisiciones, candidatos, pipeline y ofertas. |

---

## Principios

1. **TIH es la capa de skills de la plataforma.** Todas las competencias, habilidades y atributos se gestionan en Talent Intelligence Hub. JPB depende de TIH para su catálogo de atributos.

2. **TIH y JPB alimentan todo el talento.** PMGM, LMS, RCM, SDM y todos los módulos de talento consumen la ontología de skills y los perfiles de puesto definidos en TIH/JPB.

3. **Metas de desempeño y metas de desarrollo son planes separados.** Las metas de desempeño (PMGM) evalúan resultados del rol actual; las metas de desarrollo (Career Development) trazan el crecimiento hacia un rol objetivo. Nunca se mezclan en el mismo plan.

4. **Todo es configurable en Admin Center.** Cada módulo expone su configuración (plantillas, escalas, picklists, políticas) a través de Admin Center, sin necesidad de cambios en código.

5. **Versionado y transportable entre tenants.** Las configuraciones se versionan y pueden exportarse/importarse entre tenants (transport packages) para facilitar pruebas y despliegue multi-entorno.

6. **Plantillas de formulario inmutables una vez lanzadas.** Las plantillas de PMGM y 360 se manejan con import/export. Una vez que una plantilla se lanza (asociada a un ciclo activo), su versión queda fija; los cambios posteriores crean una nueva versión que aplica a ciclos futuros.
