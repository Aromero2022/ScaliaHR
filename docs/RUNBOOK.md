# Runbook local — Scalia HR

Operación de la pila local de la Fase 9a: arranque, actualización, rollback, respaldos y restauración. Todo corre contra Supabase local; ninguno de estos comandos toca un proyecto remoto: los scripts se niegan si la base no es `127.0.0.1` o `localhost`. La versión para staging y producción (Railway, Supabase Pro, PITR) se escribe en la Fase 23.

Decisiones de referencia: D17 (contenedores y worker), D20 (correo), D21 (tenant por subdominio), D22 (migraciones seguras), D23 (respaldos) y D24 (rollback) en `docs/ARCHITECTURE.md`.

---

## 1. Arranque

Requisitos: Docker con Compose v2, Node 22.12 o mayor y `npm ci` hecho.

```bash
npm run local:up
```

Qué hace, en orden:

1. Levanta Supabase local (`supabase start`) y aplica las migraciones pendientes (`supabase migration up --local`, igual que el modo producción de D22).
2. Pone contraseñas locales a `prisma_app`, `worker_app` y `email_enqueuer` desde `.env.docker`. Lo crea desde `.env.docker.example` la primera vez y le agrega las variables nuevas después.
3. Guarda las imágenes actuales como `:previous`, construye `web` y `worker` con la revisión de git como etiqueta y los arranca.
4. Pruebas de humo: `/api/health`, un job `system.ping` y un correo que debe llegar a Mailpit.

Al terminar imprime:

| Qué | Dónde |
|-----|-------|
| App | http://localhost:3000 |
| Tenant por subdominio | http://acme-corp.localhost:3000 (`<slug>.localhost`) |
| Health | http://localhost:3000/api/health |
| Studio | http://127.0.0.1:54323 |
| Mailpit (todos los correos) | http://127.0.0.1:54324 |

Logs: `docker logs -f scaliahr-web-1` y `docker logs -f scaliahr-worker-1`.

Parar: `npm run local:down` (contenedores) o `npm run local:down -- --all` (también Supabase; los datos se conservan).

**Si falla al aplicar migraciones** ("Remote migration versions not found…"): el historial de tu base local no coincide con `supabase/migrations` (por ejemplo, venías de otra rama). `supabase db reset` la reconstruye desde cero y **borra sus datos**: haz antes `npm run backup:full` si los necesitas.

## 2. Actualizar a una versión nueva

```bash
git pull
npm ci
npm run local:up
```

`local:up` aplica solo las migraciones nuevas y deja las imágenes que estaban corriendo como `:previous`, listas para el rollback. Para saber qué revisión tiene cada imagen:

```bash
docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' scaliahr-web:local scaliahr-web:previous
```

## 3. Rollback a la imagen anterior

```bash
npm run local:rollback
```

- Vuelve a arrancar `web` y `worker` con las imágenes `:previous` y repite las pruebas de humo.
- Las que estaban corriendo quedan como `:rolled-back`.
- Retrocede un solo paso. Para volver a la versión actual, `npm run local:up` reconstruye el checkout.
- **El esquema no se revierte.** Las migraciones ya aplicadas se quedan, y la versión anterior funciona con ellas porque toda migración sigue la regla expand/contract (D22). Si una migración rompió datos, el rollback de imagen no basta: restaura un respaldo (secciones 5 y 6).
- Si no hay imagen `:previous` (primer `local:up` en esa máquina), el comando se detiene sin cambiar nada.

## 4. Respaldos

Los respaldos contienen datos personales (nombres, correos, RFC, CURP, salarios). Se guardan en `.backups/`, que git y las imágenes ignoran, con permisos solo para tu usuario. No los subas a ningún servicio ni los compartas.

### 4.1 Respaldo completo

```bash
npm run backup:full
```

Crea `.backups/full-<fecha UTC>/` con:

- `app.dump`: esquemas `public`, `pgboss` y `ops`, con estructura, datos y permisos.
- `platform.dump`: cuentas (`auth.users`, identidades, factores MFA, códigos de recuperación, passkeys) e historial de migraciones.
- `manifest.json`: versión de esquema, fecha y SHA-256 de cada archivo.

Las sesiones no se respaldan: tras una restauración todos inician sesión de nuevo.

### 4.2 Export por tenant (lo ejecuta el worker)

```bash
docker exec scaliahr-worker-1 node dist/export-tenant.js <tenant-id>
```

El worker atiende el job `backup.tenant_export` y escribe `/backups/tenants/<tenant-id>/<fecha>.export.gz` en el volumen `scaliahr_backups`. El archivo incluye el registro del tenant, todas las tablas con `tenant_id` y las tablas hijas (`talent_pool_entries`, `succession_nominees`), junto con la versión de esquema, los conteos y el SHA-256. No incluye cuentas de `auth` (van en el respaldo completo), `rate_limits` ni `user_settings`.

Para copiarlo a tu máquina:

```bash
mkdir -p .backups/tenants
docker cp scaliahr-worker-1:/backups/tenants/<tenant-id>/<archivo>.export.gz .backups/tenants/
```

## 5. Restauración completa

Reemplaza toda la base local por un respaldo completo, en una sola transacción: si algo falla, no cambia nada.

```bash
npm run local:down
git checkout <commit cuya última migración coincide con manifest.json>   # solo si cambió
npm run restore:full -- .backups/full-<fecha>
npm run local:up
```

El script se niega a continuar si:

- algún archivo no coincide con su SHA-256;
- la versión de esquema del respaldo no es la última migración del checkout;
- `web` o `worker` siguen corriendo.

## 6. Restauración por tenant

Devuelve un tenant al momento de su export sin tocar a ningún otro tenant. La app puede seguir corriendo; conviene avisar al cliente, porque sus cambios posteriores al export se pierden.

```bash
npm run restore:tenant -- --tenant <tenant-id> --file .backups/tenants/<archivo>.export.gz
```

En una sola transacción:

1. Verifica el archivo: formato, SHA-256 y conteos. Verifica que el tenant sea el del archivo y que la versión de esquema sea la misma.
2. Reemplaza las filas del tenant en las tablas del export por las del archivo.
3. Bitácora: conserva las entradas posteriores al export cuyo usuario existe tras restaurar. Las demás (usuarios creados después del export) no pueden quedar en la base. Se guardan en el reporte `<archivo>.restore-<fecha>.json`, junto al archivo, para que nada se pierda en silencio.
4. Antes del COMMIT revisa todas las llaves foráneas de `public` y los conteos; si algo no cuadra, revierte todo.

Si una cuenta de `auth` del tenant se borró después del export, la restauración se niega (llave foránea de `user_tenant_memberships`): primero restaura las cuentas desde un respaldo completo.

## 7. Simulacros automáticos

CI los corre en cada PR, contra Supabase local:

- `apps/worker/__tests__/integration/backup.test.ts`: export por el worker, restauración por tenant con otro tenant intacto, rechazos (archivo de otro tenant, corrupto, de otro esquema, base remota) y respaldo completo con restauración en sitio tras borrar todos los tenants.
- Job `docker` de CI: `local:up`, export por tenant dentro del contenedor y simulacro de rollback (`local:up` dos veces y luego `local:rollback`).

## 8. Diferencias que llegan en la Fase 23

- Respaldos diarios del plan Pro y PITR para producción (D15); los exports por tenant van a almacenamiento privado y cifrado en lugar de un volumen local, y se programan a diario para tenants con licencia.
- Rollback en Railway a la imagen anterior, y procedimiento de restauración sobre staging antes de producción.
- La restauración por tenant y la completa sobre bases hospedadas necesitan su propio procedimiento: hoy los scripts solo aceptan la base local.
