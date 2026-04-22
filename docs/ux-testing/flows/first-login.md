# Flow: First Login

First experience after logging into the CMS admin panel. Tests orientation, discoverability, and first impressions of the platform.

## Accept Criteria
- [ ] Login completes in <3 seconds
- [ ] Dashboard loads without console errors
- [ ] All sidebar modules are visible and clickable
- [ ] User can identify at least 3 platform capabilities within 60 seconds
- [ ] No broken links in navigation

## Red Flags (automatic score reduction)
- Console errors on page load → First Impression -2
- Module fails to load → Navigation -2
- Blank/empty state with no guidance → First Impression -1

## Phases

### Phase 1: Login
**Actions:**
1. Navigate to `http://localhost:18055/admin/login`
2. Enter credentials (from credentials file or admin env)
3. Submit login form
4. Observe loading state and redirect

**Evaluate:** Authentication (speed, error handling, feedback)

**Persona variations:**
- **Sarah:** Types fast, might mistype password first
- **Marcus:** Reads login page carefully, notes security indicators
- **Anna:** Looks for "forgot password" and "sign up" links
- **Raj:** Inspects network requests during login, checks token handling

### Phase 2: Dashboard Orientation
**Actions:**
1. Observe initial dashboard/landing page
2. Screenshot the full dashboard
3. Read all visible text — what does this platform do?
4. Note what's immediately actionable vs confusing

**Evaluate:** First Impression (clarity, value prop, guidance)

### Phase 3: Sidebar Exploration
**Actions:**
1. Click through each sidebar module (don't deep-dive, just load)
2. Screenshot each module's landing state
3. Note: which modules load? Which are empty? Which have guidance?
4. Check for broken routes or 404s

**Evaluate:** Navigation (discoverability, organization, labels)

**Modules to visit:**
- Content (Directus default)
- Calculators
- Formulas
- AI Assistant
- Knowledge Base
- Flows
- Admin Dashboard
- Account/Settings

### Phase 4: First Interaction
**Actions:**
1. Pick the module that looks most interesting (persona-dependent)
2. Try one simple action (create, search, click)
3. Note: was it obvious what to do? Did it work?

**Evaluate:** (A) Calculator UX or (C) AI Assistant Quality (depending on choice)

**Persona variations:**
- **Sarah:** Goes to Calculators or AI Assistant
- **Marcus:** Goes to Formulas or Calculators
- **Anna:** Goes to AI Assistant or Knowledge Base
- **Raj:** Goes to API Integration or Admin Dashboard

### Phase 5: Mobile Quick Check
**Actions:**
1. Resize to 375x812
2. Navigate to dashboard
3. Try opening sidebar
4. Screenshot mobile state

**Evaluate:** Mobile Experience
