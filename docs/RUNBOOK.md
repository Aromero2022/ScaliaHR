# Runbook local — Scalia HR

Operación de la pila local de la Fase 9a: arranque, actualización, rollback, respaldos y restauración. Todo corre contra Supabase local; ninguno de estos comandos toca un proyecto remoto: los scripts se niegan si la base no es `127.0.0.1` o `localhost`. La versión para staging y producción (Railway, Supabase Pro, PITR) se escribe en la Fase 23.

Decisiones de referencia: D17 (contenedores y worker), D20 (correo), D21 (tenant por subdominio), D22 (migraciones seguras), D23 (respaldos), D24 (rollback), D28 (rate limiting) y D36 (prueba de carga) en `docs/ARCHITECTURE.md`.

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

## 8. Rate limiting (D28)

Un usuario que ve "Demasiados intentos" puede volver a intentarlo cuando pasa el tiempo que indica el mensaje: un minuto para login y MFA, una hora para el alta de empresa. Cada bloqueo deja una línea `rate_limit.blocked` en `docker logs scaliahr-web-1`.

Si hay que desbloquear antes (por ejemplo, tras una prueba), borra las ventanas de esa acción en la base local. Las llaves son hashes, así que se borra la acción completa, para todos los usuarios:

```bash
docker exec supabase_db_ScaliaHR psql -U postgres -c "DELETE FROM public.rate_limits WHERE action IN ('login', 'login_ip')"
```

Los límites de escritura y de rutas HTTP de cada empresa se cambian en Admin Center → Límites de solicitudes.

## 9. Prueba de carga (D36)

Con la pila arriba (`npm run local:up`):

```bash
npm run load:test
```

Qué hace:

1. Borra los tenants `load-*` y sus cuentas de una corrida anterior.
2. Crea `load-big` con 1,000 empleados y `load-a`, `load-b` y `load-c` con 50 cada uno, con cuentas en Supabase Auth local (`load/seed.mjs`; solo acepta la base local).
3. Corre k6 en Docker (`load/pages.js`): cada usuario inicia sesión una vez y abre páginas con 20–40 s entre ellas. Sube a 1,150 usuarios en 2 min, los sostiene 4 min y baja.

Pasa si en estado estable el p95 de las páginas es menor a 500 ms, fallan menos del 1 % y pasan más del 99 % de los checks (cada página responde 200 y no muestra empleados de otro tenant). El resumen queda en `load/.out/summary.json`; ese directorio está fuera de git.

Variables para otras corridas:

| Variable | Default | Qué cambia |
|----------|---------|------------|
| `LOAD_BIG_USERS`, `LOAD_SMALL_USERS` | 1000, 50 | Empleados y cuentas que crea el seed por tenant |
| `LOAD_VUS`, `SMALL_VUS` | 1000, 50 | Usuarios concurrentes en `load-big` y en cada tenant chico (no más que los empleados) |
| `RAMP`, `HOLD` | `2m`, `4m` | Tiempo de subida y tiempo a carga completa |
| `THINK_MIN`, `THINK_MAX` | 20, 40 | Segundos entre páginas de cada usuario |

Capacidad de un proceso web, con pausas cortas:

```bash
THINK_MIN=2 THINK_MAX=6 LOAD_VUS=150 SMALL_VUS=10 npm run load:test
```

La prueba deja los tenants `load-*` en la base local; la siguiente corrida o `supabase db reset` los borra.

### Qué detecta el CI y qué queda para esta corrida

El job `docker` de CI corre una versión corta (75 usuarios, 40 s a carga completa) en cada PR a `main`. La comparación con `main` (D36) se hace a mano: el loop toma el p95 del log del job y la anota en la tabla de verificación del PR. Ningún script calcula la banda.

- Línea base: la mediana del p95 en estado estable de las últimas 5 corridas de `main`.
- Límite: el mayor entre mediana × 1.2 y mediana + 2 × MAD de esas 5 corridas (MAD sin escalar).
- Una primera corrida sobre el límite se confirma volviendo a correr el job una vez; bloquea si las dos lo pasan. También bloquea si el p95 pasa de 500 ms.
- Si el diff solo toca `**/*.md`, `docs/**` o `.claude/**`, la comparación no aplica (sin cambios en la imagen).
- Edad máxima de la línea base: las 5 corridas válidas se buscan solo entre los últimos 10 commits de `main` (los que `main` fue apuntando, cada uno con su corrida de CI). Si no hay 5, la tabla de verificación dice "sin línea base": la comparación no se aplica (el techo de 500 ms sigue) y el PR no se mergea sin una excepción explícita del usuario. Si alguna de las últimas 3 corridas de `main` no tiene resultado de k6, se investiga por qué y el siguiente PR de la fase no se abre hasta que se abra la investigación.
- Corrida de `main` sobre el límite: cada PR revisa en su tabla de verificación la última corrida de `main` contra la banda de las 5 anteriores. Si la pasa, se anota "main sobre el límite" con el commit. Dos corridas seguidas de `main` sobre su límite cuentan como "deriva (main ×2)": el siguiente PR de la fase no se abre hasta que se abra la investigación.
- La banda de una corrida de `main` sale de las 5 corridas válidas anteriores, todas dentro de la misma ventana de 10 commits. Si no hay 5 anteriores válidas, la tabla dice "main sin revisar"; es informativo y no bloquea. Si la última de `main` no tiene k6, aplica la regla de las últimas 3 corridas sin k6.
- "Dos seguidas" se cuenta por commit de `main`, no por PR: cada PR revisa todas las corridas de `main` que entraron desde la tabla del PR anterior, cada una una sola vez, y "dos seguidas" son dos commits consecutivos del historial de primer padre de `main`.
- Control de deriva (D36): la tabla marca "deriva (referencia)" si la mediana de 5 de `main` supera en más de 50 % la referencia de 92.04 ms, y "deriva (main ×2)" con dos corridas seguidas de `main` sobre su límite. Las dos tienen la misma consecuencia: el siguiente PR de la fase no se abre hasta que se abra la investigación.
- Una corrida de `main` sobre el límite sigue contando en la línea base. No se excluyen valores atípicos: quitarlos bajaría la banda a mano.
- Una investigación se cierra cuando la causa queda escrita en D36 o cuando el usuario acepta el nivel nuevo con una decisión anotada en D36.
- Los últimos 10 commits se cuentan cuando se llena la tabla de verificación del PR, es decir, cuando termina el CI de su head.

El CI ya no detecta regresiones menores a unos +50 %. Con esa banda, el bloqueo falso estimado es 5 %; una regresión de +50 % se bloquea 31 % de las veces, una de +100 % el 60 % y una de +150 % siempre. La muestra es de 9 corridas, así que estos números son un orden de magnitud.

Por eso la corrida completa de esta sección (1,150 usuarios) se hace en local al cerrar cada fase.

## 10. e2e y accesibilidad (D44)

Con la pila arriba (`npm run local:up`), y Chromium de Playwright instalado una vez (`npx playwright install chromium` en `apps/web`):

```bash
npm run e2e
```

Qué hace:

1. Crea tres cuentas `@e2e.scaliahr.test` ligadas a empleadas del tenant demo (empleada, admin con TOTP y admin sin factor), con una contraseña nueva y aleatoria. Solo acepta la base local. La contraseña, el secreto TOTP y las sesiones quedan en una carpeta temporal privada, fuera del repositorio. También agrega la habilidad "Prueba e2e de autoevaluación" (D46).
2. Corre la suite de Playwright de `apps/web` contra `http://localhost:3000`: logins, páginas protegidas, diálogos y "Más" con el teclado, zoom, skeleton y axe en claro y oscuro, y el guardado con datos demo (D46): un cambio de puesto de Patricia Castro con motivo `[e2e]` y una autoevaluación en esa habilidad.
3. Busca la contraseña y los secretos TOTP en los artefactos (también dentro del reporte HTML) y corre gitleaks sobre ellos; si algo aparece, borra los artefactos.
4. Siempre borra las cuentas, sus sesiones y sus factores, y deshace lo guardado con datos demo (el cambio de puesto y la habilidad de prueba), así que se puede repetir sin `supabase db reset`. Las entradas de la bitácora de esas acciones se quedan, como las de los logins.

Resultados en `apps/web/e2e-artifacts` (fuera de git): `report/index.html`, `axe/axe-summary.md`, las capturas en `captures/` y la evidencia del skeleton en `skeleton/`. Para una sola parte, los argumentos van a Playwright: `npm run e2e -- zoom.spec.ts`.

## 11. Diferencias que llegan en la Fase 23

- Respaldos diarios del plan Pro y PITR para producción (D15); los exports por tenant van a almacenamiento privado y cifrado en lugar de un volumen local, y se programan a diario para tenants con licencia.
- Rollback en Railway a la imagen anterior, y procedimiento de restauración sobre staging antes de producción.
- La restauración por tenant y la completa sobre bases hospedadas necesitan su propio procedimiento: hoy los scripts solo aceptan la base local.
