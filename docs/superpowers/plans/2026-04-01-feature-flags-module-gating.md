# Feature Flags — Module Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide disabled features from non-admin CMS users — no modules, no UI, no broken API calls.

**Architecture:** Add a user-facing `/features/my` endpoint to the feature-flags hook. Create a shared `FeatureGate` Vue component that wraps each module's root template. When a feature is disabled for the user's account, the gate replaces the module content with a clean "unavailable" message. Admin users always bypass the gate.

**Tech Stack:** Vue 3, Directus Extensions SDK, existing feature-flags hook (Knex + ioredis)

---

## Context

The feature flags system (phase 1) was implemented on branch `dm/feature-flags`. It provides:
- `platform_features` / `account_features` DB tables with Redis sync
- Gateway enforcement for external API traffic
- Admin UI for toggling flags

**Gap:** CMS frontend modules call hook endpoints directly (not through gateway). Non-admin users see modules in sidebar and get 403 errors when features are disabled. This iteration gates the CMS frontend.

## Module → Feature Flag Mapping

| Module Extension | Module ID | Feature Key | Entry Component |
|-----------------|-----------|-------------|-----------------|
| `project-extension-ai-assistant` | `ai-assistant` | `ai.chat` | `src/module.vue` |
| `project-extension-knowledge` | `knowledge` | `ai.kb` | `src/routes/module.vue` |
| `project-extension-calculators` | `calculators` | `calc.execute` | `src/routes/module.vue` |
| `project-extension-formulas` | `formulas` | `calc.execute` | `src/routes/test.vue`, `src/routes/integration.vue` |
| `project-extension-flows` | `flows` | `flow.execute` | `src/routes/flow-list.vue`, `src/routes/flow-editor.vue`, `src/routes/flow-executions.vue` |
| `project-extension-layout-builder` | `layout-builder` | `widget.builder` | Already admin-only via `preRegisterCheck` — no change needed |

**Not gated (always visible):**
- `project-extension-account` — account management, no feature flag
- `project-extension-admin` — admin-only via `preRegisterCheck`
- `project-extension-ai-observatory` — admin-only via `preRegisterCheck`

## File Structure

### New Files
| Path | Responsibility |
|------|---------------|
| `services/cms/extensions/local/project-extension-feature-flags/src/resolve-own.ts` | Handler for `/features/my` endpoint (user-facing) |
| `services/cms/extensions/local/project-extension-feature-gate/package.json` | Shared component extension (Directus panel type=component) |
| `services/cms/extensions/local/project-extension-feature-gate/tsconfig.json` | TypeScript config |
| `services/cms/extensions/local/project-extension-feature-gate/src/index.ts` | Exports composable |
| `services/cms/extensions/local/project-extension-feature-gate/src/use-feature-gate.ts` | `useFeatureGate(api, featureKey)` composable |
| `services/cms/extensions/local/project-extension-feature-flags/src/__tests__/resolve-own.test.ts` | Tests for /features/my |

### Modified Files
| Path | Change |
|------|--------|
| `services/cms/extensions/local/project-extension-feature-flags/src/index.ts` | Add `/features/my` route |
| `services/cms/extensions/local/project-extension-ai-assistant/src/module.vue` | Wrap in feature gate |
| `services/cms/extensions/local/project-extension-knowledge/src/routes/module.vue` | Wrap in feature gate |
| `services/cms/extensions/local/project-extension-calculators/src/routes/module.vue` | Wrap in feature gate |
| `services/cms/extensions/local/project-extension-formulas/src/routes/test.vue` | Wrap in feature gate |
| `services/cms/extensions/local/project-extension-formulas/src/routes/integration.vue` | Wrap in feature gate |
| `services/cms/extensions/local/project-extension-flows/src/routes/flow-list.vue` | Wrap in feature gate |
| `services/cms/extensions/local/project-extension-flows/src/routes/flow-editor.vue` | Wrap in feature gate |
| `services/cms/extensions/local/project-extension-flows/src/routes/flow-executions.vue` | Wrap in feature gate |

---

## Task 1: Add `/features/my` User-Facing Endpoint

**Files:**
- Create: `services/cms/extensions/local/project-extension-feature-flags/src/resolve-own.ts`
- Modify: `services/cms/extensions/local/project-extension-feature-flags/src/index.ts`
- Test: `services/cms/extensions/local/project-extension-feature-flags/src/__tests__/resolve-own.test.ts`

This endpoint resolves feature flags for the **current logged-in user's active account**. Unlike `/features/resolve/:accountId` (admin-only), this uses `requireAuth` only — any logged-in user can check their own flags. Admin users always get all features enabled (bypass).

- [ ] **Step 1: Write failing test for resolve-own handler**

In `services/cms/extensions/local/project-extension-feature-flags/src/__tests__/resolve-own.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createResolveOwnHandler } from '../resolve-own.js';

function mockDb(overrides: Record<string, any> = {}) {
	const chain = {
		where: vi.fn().mockReturnThis(),
		select: vi.fn().mockReturnThis(),
		orderBy: vi.fn().mockReturnThis(),
		first: vi.fn().mockResolvedValue(overrides.userFirst ?? null),
	};
	const fn: any = vi.fn().mockReturnValue(chain);

	// Second call for platform_features
	let callCount = 0;
	fn.mockImplementation((table: string) => {
		callCount++;
		if (table === 'directus_users') {
			return {
				where: vi.fn().mockReturnThis(),
				select: vi.fn().mockReturnThis(),
				first: vi.fn().mockResolvedValue(overrides.userFirst ?? null),
			};
		}
		if (table === 'platform_features') {
			return {
				select: vi.fn().mockReturnThis(),
				orderBy: vi.fn().mockReturnValue({
					orderBy: vi.fn().mockResolvedValue(overrides.features ?? []),
				}),
			};
		}
		if (table === 'account_features') {
			return {
				where: vi.fn().mockReturnThis(),
				select: vi.fn().mockResolvedValue(overrides.overrides ?? []),
			};
		}
		return chain;
	});
	return fn;
}

function mockRes() {
	const res: any = {
		status: vi.fn().mockReturnThis(),
		json: vi.fn(),
	};
	return res;
}

describe('resolveOwn', () => {
	it('returns resolved features for user with active account', async () => {
		const db = mockDb({
			userFirst: { active_account: 'acc-1' },
			features: [
				{ id: 'f1', key: 'ai.chat', name: 'AI Chat', category: 'ai', enabled: true },
				{ id: 'f2', key: 'ai.kb', name: 'Knowledge Base', category: 'ai', enabled: false },
			],
			overrides: [
				{ feature: 'f2', enabled: true },
			],
		});

		const handler = createResolveOwnHandler(db);
		const req: any = { accountability: { user: 'user-1', admin: false } };
		const res = mockRes();

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({
			data: [
				{ key: 'ai.chat', name: 'AI Chat', category: 'ai', enabled: true, source: 'platform' },
				{ key: 'ai.kb', name: 'Knowledge Base', category: 'ai', enabled: true, source: 'override' },
			],
		});
	});

	it('returns all features enabled for admin users', async () => {
		const db = mockDb({
			features: [
				{ id: 'f1', key: 'ai.chat', name: 'AI Chat', category: 'ai', enabled: false },
			],
			overrides: [],
		});

		const handler = createResolveOwnHandler(db);
		const req: any = { accountability: { user: 'admin-1', admin: true } };
		const res = mockRes();

		await handler(req, res);

		expect(res.json).toHaveBeenCalledWith({
			data: [
				{ key: 'ai.chat', name: 'AI Chat', category: 'ai', enabled: true, source: 'admin' },
			],
		});
	});

	it('returns 403 when user has no active account', async () => {
		const db = mockDb({ userFirst: { active_account: null } });

		const handler = createResolveOwnHandler(db);
		const req: any = { accountability: { user: 'user-2', admin: false } };
		const res = mockRes();

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(403);
	});
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd services/cms/extensions/local/project-extension-feature-flags && npx vitest run src/__tests__/resolve-own.test.ts
```

Expected: FAIL — `createResolveOwnHandler` not found

- [ ] **Step 3: Implement resolve-own handler**

Create `services/cms/extensions/local/project-extension-feature-flags/src/resolve-own.ts`:

```typescript
export function createResolveOwnHandler(db: any) {
	return async (req: any, res: any) => {
		try {
			const userId = req.accountability?.user;

			// Admin bypass — all features enabled
			if (req.accountability?.admin) {
				const features = await db('platform_features')
					.select('id', 'key', 'name', 'category', 'enabled')
					.orderBy('category', 'asc')
					.orderBy('sort', 'asc');

				return res.json({
					data: features.map((f: any) => ({
						key: f.key,
						name: f.name,
						category: f.category,
						enabled: true,
						source: 'admin' as const,
					})),
				});
			}

			// Get user's active account
			const user = await db('directus_users')
				.where('id', userId)
				.select('active_account')
				.first();

			if (!user?.active_account) {
				return res.status(403).json({
					errors: [{ message: 'No active account' }],
				});
			}

			const accountId = user.active_account;

			// Fetch platform features + account overrides
			const features = await db('platform_features')
				.select('id', 'key', 'name', 'category', 'enabled')
				.orderBy('category', 'asc')
				.orderBy('sort', 'asc');

			const overrides = await db('account_features')
				.where('account', accountId)
				.select('feature', 'enabled');

			const overrideMap = new Map<string, boolean>();
			for (const o of overrides) {
				overrideMap.set(o.feature, o.enabled);
			}

			const resolved = features.map((f: any) => {
				const hasOverride = overrideMap.has(f.id);
				return {
					key: f.key,
					name: f.name,
					category: f.category,
					enabled: hasOverride ? overrideMap.get(f.id)! : f.enabled,
					source: hasOverride ? 'override' as const : 'platform' as const,
				};
			});

			res.json({ data: resolved });
		} catch (err: any) {
			res.status(500).json({
				errors: [{ message: 'Failed to resolve features' }],
			});
		}
	};
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
cd services/cms/extensions/local/project-extension-feature-flags && npx vitest run
```

Expected: ALL PASS (previous 24 + new 3)

- [ ] **Step 5: Register route in index.ts**

In `services/cms/extensions/local/project-extension-feature-flags/src/index.ts`, add import at top:

```typescript
import { createResolveOwnHandler } from './resolve-own.js';
```

Add route registration after the existing `/features/resolve/:accountId` route (before `logger.info('[feature-flags] routes registered')`):

```typescript
		// GET /features/my — resolve features for current user (non-admin)
		app.get('/features/my', requireAuth, createResolveOwnHandler(db));
```

- [ ] **Step 6: Run tests again — verify nothing broke**

```bash
cd services/cms/extensions/local/project-extension-feature-flags && npx vitest run
```

Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add services/cms/extensions/local/project-extension-feature-flags/
git commit -m "feat(cms): add /features/my endpoint for user feature resolution"
```

---

## Task 2: Create `useFeatureGate` Composable

**Files:**
- Create: `services/cms/extensions/local/project-extension-feature-gate/package.json`
- Create: `services/cms/extensions/local/project-extension-feature-gate/tsconfig.json`
- Create: `services/cms/extensions/local/project-extension-feature-gate/src/index.ts`
- Create: `services/cms/extensions/local/project-extension-feature-gate/src/use-feature-gate.ts`

This is NOT a Directus extension — it's a shared source module that other extensions import from at build time. Since all CMS extensions are built together (same node_modules tree), they can import from a sibling package via relative paths or npm workspace.

**Approach:** Since Directus extensions are bundled at build time, the simplest approach is to put the composable in a standalone file that each module copies or imports relatively. But to avoid duplication, we'll create it as a local package and have each module import it via a relative path to the source.

Actually, simpler: just create the composable file once and have each module import from a relative path like `../../project-extension-feature-gate/src/use-feature-gate`.

- [ ] **Step 1: Create package.json**

Create `services/cms/extensions/local/project-extension-feature-gate/package.json`:

```json
{
  "name": "project-extension-feature-gate",
  "version": "1.0.0",
  "type": "module",
  "main": "src/index.ts"
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `services/cms/extensions/local/project-extension-feature-gate/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create the composable**

Create `services/cms/extensions/local/project-extension-feature-gate/src/use-feature-gate.ts`:

```typescript
import { ref, onMounted } from 'vue';

export interface FeatureGateState {
	/** Whether the gated feature is allowed */
	allowed: boolean;
	/** Whether the check is still loading */
	loading: boolean;
	/** Error message if check failed */
	error: string | null;
	/** Whether the user is admin (always allowed) */
	isAdmin: boolean;
}

/**
 * Composable that checks whether a feature is enabled for the current user.
 * Admin users always pass. Non-admin users' flags are resolved via /features/my.
 * On error, defaults to allowed (fail-open for CMS UI — gateway is the enforcement point).
 */
export function useFeatureGate(api: any, featureKey: string) {
	const allowed = ref(true); // optimistic default
	const loading = ref(true);
	const error = ref<string | null>(null);
	const isAdmin = ref(false);

	async function check() {
		loading.value = true;
		error.value = null;

		try {
			const res = await api.get('/features/my');
			const features: Array<{ key: string; enabled: boolean; source: string }> = res.data?.data ?? res.data ?? [];

			// Admin bypass — all features have source='admin'
			if (features.length > 0 && features[0].source === 'admin') {
				isAdmin.value = true;
				allowed.value = true;
				loading.value = false;
				return;
			}

			const feature = features.find((f: any) => f.key === featureKey);
			if (!feature) {
				// Feature not registered — fail-open in CMS (gateway enforces)
				allowed.value = true;
			} else {
				allowed.value = feature.enabled;
			}
		} catch (err: any) {
			// Fail-open: if we can't check, allow access (gateway is the real gate)
			error.value = err?.message || 'Feature check failed';
			allowed.value = true;
		} finally {
			loading.value = false;
		}
	}

	onMounted(check);

	return { allowed, loading, error, isAdmin, check };
}
```

- [ ] **Step 4: Create index.ts**

Create `services/cms/extensions/local/project-extension-feature-gate/src/index.ts`:

```typescript
export { useFeatureGate } from './use-feature-gate.js';
export type { FeatureGateState } from './use-feature-gate.js';
```

- [ ] **Step 5: Commit**

```bash
git add services/cms/extensions/local/project-extension-feature-gate/
git commit -m "feat(cms): add useFeatureGate composable for module gating"
```

---

## Task 3: Gate AI Assistant Module

**Files:**
- Modify: `services/cms/extensions/local/project-extension-ai-assistant/src/module.vue`

The AI Assistant has a single route component `module.vue`. Wrap its content in a feature gate.

- [ ] **Step 1: Add feature gate to module.vue**

In `services/cms/extensions/local/project-extension-ai-assistant/src/module.vue`, add the import in the `<script setup>` section:

```typescript
import { useFeatureGate } from '../../project-extension-feature-gate/src/use-feature-gate';
```

Add after other composable calls (near the top of the script):

```typescript
const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'ai.chat');
```

Note: `api` is already available via `useApi()` in this component (check the existing script — it imports `useApi` from `@directus/extensions-sdk`).

- [ ] **Step 2: Wrap template content**

In the `<template>` section, inside `<private-view>`, wrap the main content. Find the `<div class="ai-assistant">` and the navigation/actions templates.

Add a feature gate check. After the `<template #navigation>` and `<template #actions>` blocks (which stay unchanged — we want the shell to render), wrap the main content area:

```vue
		<!-- Feature gate -->
		<div v-if="featureLoading" class="feature-gate-loading">
			<v-progress-circular indeterminate />
		</div>
		<div v-else-if="!featureAllowed" class="feature-gate-unavailable">
			<v-info icon="block" title="Feature Unavailable" center>
				AI Assistant is not available for your account. Contact your administrator.
			</v-info>
		</div>
		<div v-else class="ai-assistant">
			<!-- ... existing content unchanged ... -->
		</div>
```

Replace the outermost `<div class="ai-assistant">` with the gated version above. The existing content inside `<div class="ai-assistant">` stays unchanged — just wrap it with the v-if/v-else-if/v-else.

- [ ] **Step 3: Add CSS for gate states**

In the `<style scoped>` section, add:

```css
.feature-gate-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}

.feature-gate-unavailable {
	padding: var(--content-padding);
	padding-top: 120px;
}
```

- [ ] **Step 4: Build and verify**

```bash
cd services/cms/extensions/local/project-extension-ai-assistant && npx directus-extension build
```

Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add services/cms/extensions/local/project-extension-ai-assistant/
git commit -m "feat(cms): gate AI Assistant module by ai.chat feature flag"
```

---

## Task 4: Gate Knowledge Base Module

**Files:**
- Modify: `services/cms/extensions/local/project-extension-knowledge/src/routes/module.vue`

Same pattern as Task 3 but for Knowledge Base.

- [ ] **Step 1: Add feature gate import and composable**

In `<script setup>` of `services/cms/extensions/local/project-extension-knowledge/src/routes/module.vue`:

```typescript
import { useFeatureGate } from '../../../project-extension-feature-gate/src/use-feature-gate';
```

Add after other composable calls:

```typescript
const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'ai.kb');
```

- [ ] **Step 2: Wrap template content**

Inside `<private-view>`, after the `#navigation` and `#actions` template slots, wrap the main content:

```vue
		<!-- Feature gate -->
		<div v-if="featureLoading" class="feature-gate-loading">
			<v-progress-circular indeterminate />
		</div>
		<div v-else-if="!featureAllowed" class="feature-gate-unavailable">
			<v-info icon="block" title="Feature Unavailable" center>
				Knowledge Base is not available for your account. Contact your administrator.
			</v-info>
		</div>
		<template v-else>
			<!-- existing content: the v-if="currentId && currentKb" block and empty state -->
		</template>
```

- [ ] **Step 3: Add gate CSS (same as Task 3)**

```css
.feature-gate-loading {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 400px;
}

.feature-gate-unavailable {
	padding: var(--content-padding);
	padding-top: 120px;
}
```

- [ ] **Step 4: Build and verify**

```bash
cd services/cms/extensions/local/project-extension-knowledge && npx directus-extension build
```

- [ ] **Step 5: Commit**

```bash
git add services/cms/extensions/local/project-extension-knowledge/
git commit -m "feat(cms): gate Knowledge Base module by ai.kb feature flag"
```

---

## Task 5: Gate Calculators Module

**Files:**
- Modify: `services/cms/extensions/local/project-extension-calculators/src/routes/module.vue`

- [ ] **Step 1: Add feature gate**

In `<script setup>`:

```typescript
import { useFeatureGate } from '../../../project-extension-feature-gate/src/use-feature-gate';
```

After other composable calls (api is already available from `useApi()`):

```typescript
const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'calc.execute');
```

- [ ] **Step 2: Wrap template content**

Same pattern — wrap the main content area (everything inside `<private-view>` after the slot templates) with feature gate v-if/v-else-if/v-else:

```vue
		<div v-if="featureLoading" class="feature-gate-loading">
			<v-progress-circular indeterminate />
		</div>
		<div v-else-if="!featureAllowed" class="feature-gate-unavailable">
			<v-info icon="block" title="Feature Unavailable" center>
				Calculators are not available for your account. Contact your administrator.
			</v-info>
		</div>
		<template v-else>
			<!-- existing module content unchanged -->
		</template>
```

- [ ] **Step 3: Add gate CSS**

Same `.feature-gate-loading` and `.feature-gate-unavailable` styles.

- [ ] **Step 4: Build and verify**

```bash
cd services/cms/extensions/local/project-extension-calculators && npx directus-extension build
```

- [ ] **Step 5: Commit**

```bash
git add services/cms/extensions/local/project-extension-calculators/
git commit -m "feat(cms): gate Calculators module by calc.execute feature flag"
```

---

## Task 6: Gate Formulas Module

**Files:**
- Modify: `services/cms/extensions/local/project-extension-formulas/src/routes/test.vue`
- Modify: `services/cms/extensions/local/project-extension-formulas/src/routes/integration.vue`

Formulas has TWO route components. Both need gating.

- [ ] **Step 1: Gate test.vue**

In `services/cms/extensions/local/project-extension-formulas/src/routes/test.vue`, add in `<script setup>`:

```typescript
import { useFeatureGate } from '../../../project-extension-feature-gate/src/use-feature-gate';

const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'calc.execute');
```

Wrap template content with gate (same pattern).

- [ ] **Step 2: Gate integration.vue**

In `services/cms/extensions/local/project-extension-formulas/src/routes/integration.vue`, same changes:

```typescript
import { useFeatureGate } from '../../../project-extension-feature-gate/src/use-feature-gate';

const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'calc.execute');
```

Wrap template content with gate.

- [ ] **Step 3: Add gate CSS to both files**

Same `.feature-gate-loading` and `.feature-gate-unavailable` styles in both files.

- [ ] **Step 4: Build and verify**

```bash
cd services/cms/extensions/local/project-extension-formulas && npx directus-extension build
```

- [ ] **Step 5: Commit**

```bash
git add services/cms/extensions/local/project-extension-formulas/
git commit -m "feat(cms): gate Formulas module by calc.execute feature flag"
```

---

## Task 7: Gate Flows Module

**Files:**
- Modify: `services/cms/extensions/local/project-extension-flows/src/routes/flow-list.vue`
- Modify: `services/cms/extensions/local/project-extension-flows/src/routes/flow-editor.vue`
- Modify: `services/cms/extensions/local/project-extension-flows/src/routes/flow-executions.vue`

Flows has THREE route components. All need gating.

- [ ] **Step 1: Gate flow-list.vue**

In `<script setup>`:

```typescript
import { useFeatureGate } from '../../../project-extension-feature-gate/src/use-feature-gate';
import { useApi } from '@directus/extensions-sdk';

const api = useApi(); // if not already present
const { allowed: featureAllowed, loading: featureLoading } = useFeatureGate(api, 'flow.execute');
```

Wrap template content inside `<private-view>` (after slot templates) with gate. Message: "Flows are not available for your account. Contact your administrator."

- [ ] **Step 2: Gate flow-editor.vue**

Same pattern — import composable, add gate to template.

- [ ] **Step 3: Gate flow-executions.vue**

Same pattern.

- [ ] **Step 4: Add gate CSS to all three files**

- [ ] **Step 5: Build and verify**

```bash
cd services/cms/extensions/local/project-extension-flows && npx directus-extension build
```

- [ ] **Step 6: Commit**

```bash
git add services/cms/extensions/local/project-extension-flows/
git commit -m "feat(cms): gate Flows module by flow.execute feature flag"
```

---

## Task 8: Build All Extensions + Browser QA

- [ ] **Step 1: Build all extensions**

```bash
cd services/cms && make ext-build-all
```

Verify all extensions build without errors.

- [ ] **Step 2: Restart Directus**

```bash
cd services/cms && docker compose restart directus
```

- [ ] **Step 3: Browser QA**

Run `/browser-qa` with this test plan:

1. Login as admin → navigate to Features → disable `ai.chat` → navigate to AI Assistant → verify it still works (admin bypass)
2. Login as non-admin user (or verify via `/features/my` endpoint that admin sees `source: admin`)
3. Verify all modules load when features are enabled
4. Verify disabled features show "Feature Unavailable" message
5. Verify no console errors

- [ ] **Step 4: Commit build artifacts if needed**

```bash
git add -A && git commit -m "chore(cms): rebuild all extensions with feature gates"
```

---

## Unresolved Questions

- Should disabled modules still appear in the sidebar with a lock icon, or fully hidden? (Current plan: visible but shows "unavailable" message inside — `preRegisterCheck` can't do async account-based checks)
- Should the feature gate cache the `/features/my` response across modules to avoid N requests per page load? (Could use a shared reactive store, but adds complexity)
- Should the `widget.builder` flag gate the layout builder for admins too, or is `preRegisterCheck(admin_access)` sufficient?
