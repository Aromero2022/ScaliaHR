# Scalia HR — Claude Code Guidelines

## Reglas del bucle (aplican a TODOS los loops)

- No existen errores "pre-existentes": lint, typecheck y build deben terminar en CERO errores. Si algo falla, se corrige en el mismo loop.
- Las garantías de seguridad (RLS, privilegios, FKs) se prueban contra la base local real (`supabase start`), no solo con mocks.
- Ninguna migración se da por buena sin `supabase db reset` exitoso.
- Las rutas protegidas viven en el grupo `(protected)` sin prefijo `/app`.

## Reglas de seguridad y esquema

- `supabase/migrations` (SQL) es la UNICA fuente de verdad del esquema. Prisma solo via `npm run db:sync` (db pull + generate). PROHIBIDO `prisma migrate` y `prisma db push`.
- ENABLE + FORCE ROW LEVEL SECURITY en toda tabla nueva. Sin politica DELETE para `authenticated` (solo soft delete).
- `users` tiene SELECT por columna con lista explicita (D47): toda columna nueva de `users` es ilegible para anon, authenticated y `prisma_app` hasta que una migracion le de GRANT.
- GRANT EXECUTE al hook solo a `supabase_auth_admin`; REVOKE a PUBLIC, anon y authenticated.
- `service_role` y conexiones privilegiadas nunca en codigo cliente.
- Toda entrada externa se valida con Zod.
- Trabaja SOLO contra el entorno local (`supabase start`). Nunca ejecutes nada contra un proyecto Supabase remoto sin confirmacion explicita del usuario.

## Estructura del proyecto

- Turborepo monorepo: `apps/*`, `packages/*`
- Web app: Next.js 15 App Router en `apps/web`
- Rutas protegidas: `apps/web/src/app/(protected)/`
- Tests: Vitest en `apps/web/__tests__/`
- Migraciones: `supabase/migrations/` (orden cronologico en el nombre)

## Forma de trabajo

- Los PRs de Dependabot se revisan como cualquier otro y solo se mergean entre loops, nunca con un PR de loop abierto; si CI falla, se investiga igual que un PR propio.

## Agentes ECC en los loops (.claude/agents)

### Precedencia
1. CLAUDE.md prevalece sobre cualquier agente, skill, comando o regla de ECC (D50). Si un agente sugiere algo que contradice CLAUDE.md, se descarta y se anota en la tabla de verificación.
2. Los agentes de revisión solo reportan. Las correcciones las hace el loop principal, con cambios quirúrgicos y dentro del alcance del PR.
3. Lo que un agente reporte fuera del alcance del PR no se corrige: se anota como observación con la fase en que entra.

### Etapa 1: Entender y planear (antes de escribir código, solo lectura)
- code-explorer: siempre que el PR toque código existente. Mapea rutas, capas y dependencias afectadas.
- planner: features nuevas o cambios en más de un módulo. El plan es breve y verificable; no genera PRD ni documentos de diseño.
- architect y code-architect: solo si el PR introduce una decisión D nueva o un patrón nuevo. Sus propuestas se contrastan con docs/ARCHITECTURE.md antes de aplicarse.

### Etapa 2: Implementar
- build-error-resolver: cuando fallen tsc o build. Solo diffs mínimos, sin cambios de arquitectura.
- react-build-resolver: cuando falle el build de Next.js por JSX/TSX, hidratación o la frontera server/client.
- Ningún error se clasifica como "pre-existente": lo que falle se corrige en el mismo loop.

### Etapa 3: Revisión obligatoria (en paralelo, sobre git diff contra main, antes de abrir o actualizar el PR)
Siempre:
- code-reviewer
- typescript-reviewer
- security-reviewer: aislamiento por tenant, RLS (ENABLE + FORCE), privilegios, zod en toda entrada externa, safeError con request id, escape de filtros de PostgREST, rate limiter en Server Actions y rutas, service_role nunca en cliente.
- silent-failure-hunter
- pr-test-analyzer: cobertura de comportamiento y que la seguridad se pruebe contra la base local real, no solo con mocks.
Según lo que cambie:
- database-reviewer: cualquier cambio en supabase/migrations o SQL. Verifica soft delete (sin DELETE para authenticated) y GRANT EXECUTE del hook solo a supabase_auth_admin.
- react-reviewer: cualquier .tsx.
- a11y-architect: cualquier cambio de UI (WCAG 2.2 AA y reglas de 9c). Solo reporta; no edita archivos.
- type-design-analyzer: tipos, esquemas zod o contratos nuevos.
- comment-analyzer: comentarios o documentación en código nuevos o modificados.
- performance-optimizer: rutas críticas, consultas pesadas, bundle o cuando se corra k6. Solo reporta; no edita.
Cierre de la etapa:
- Todo hallazgo bloqueante (crítico o alto) se corrige y se vuelve a correr el agente que lo detectó hasta que salga limpio.
- La tabla de verificación del PR lleva una fila por agente: hallazgos, cómo se resolvieron y cuáles quedan como observación con su fase.

### Etapa 4: E2E
- e2e-runner: solo si cambian flujos de UI. Usa únicamente Playwright local; nada de Vercel Agent Browser ni servicios remotos. Las pruebas se ejecutan de verdad (no solo --list) y nunca se ponen en cuarentena ni se desactivan para pasar CI.

### Agentes que solo se usan si yo lo pido explícitamente
- tdd-guide: el criterio de pruebas es el de CLAUDE.md, no el 80 % de ECC.
- code-simplifier y refactor-cleaner: solo en un PR propio de limpieza; nunca dentro de un PR de feature.
- doc-updater: no genera docs/CODEMAPS ni reescribe README, ROADMAP o ARCHITECTURE.

### Agentes que no se usan en este proyecto
chief-of-staff, conversation-analyzer (alimenta /hookify), harness-optimizer, loop-operator, spec-miner, agent-evaluator.

### Comandos y skills de ECC que no se usan
/pr, /prp-pr, /checkpoint, /quality-gate, /hookify*, /learn*, /evolve, /instinct-*, /promote, /prune, /loop-start, /loop-status, /security-scan, /update-docs, /update-codemaps; skills council, santa-method, continuous-learning, continuous-learning-v2, unified-memory. Activar cualquier hook requiere un PR propio (D50).

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
