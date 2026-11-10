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
