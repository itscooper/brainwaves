/**
 * E2E tests for core Brainwaves customer journeys.
 *
 * Journeys covered:
 * 1. Parent: open form link → enter name → answer questions → submit
 * 2. Teacher: login → dashboard → group → profile
 * 3. Teacher: create and delete a group via API
 * 4. API: health, auth guards, profile token flow
 */

const { test, expect } = require('@playwright/test');

const ADMIN_EMAIL = 'admin@admin.com';
const GROUP_TOKEN_YEAR1 = '123456';
const GROUP_TOKEN_YEAR3 = '123457';
const KNOWN_PASSWORD = 'TestPassword123!';

let adminPassword = '';
let authToken = '';

/** Login via API, handle forced password change, return a valid Bearer token. */
async function getAuthToken(request) {
  if (authToken) {
    const me = await request.get('/users/me', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (me.ok()) return authToken;
    authToken = '';
  }

  const loginResp = await request.post('/auth/jwt/login', {
    form: { username: ADMIN_EMAIL, password: adminPassword },
  });
  if (!loginResp.ok()) throw new Error(`Login failed (${loginResp.status()})`);

  const data = await loginResp.json();
  authToken = data.access_token;

  if (loginResp.headers()['x-password-change-required'] === 'true') {
    const changeResp = await request.patch('/users/me', {
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      data: { password: KNOWN_PASSWORD },
    });
    expect(changeResp.ok()).toBeTruthy();
    adminPassword = KNOWN_PASSWORD;

    const reLogin = await request.post('/auth/jwt/login', {
      form: { username: ADMIN_EMAIL, password: adminPassword },
    });
    expect(reLogin.ok()).toBeTruthy();
    authToken = (await reLogin.json()).access_token;
  }

  return authToken;
}

/** Set auth token in page localStorage (must navigate to origin first). */
async function injectToken(page, token) {
  await page.goto('/c/login/');
  await page.evaluate((t) => localStorage.setItem('token', t), token);
}

// ─── Global setup ──────────────────────────────────────────────────────────
test.beforeAll(async () => {
  const { execSync } = require('child_process');
  const logs = execSync('docker logs fastapi_container 2>&1').toString();
  const match = logs.match(/Admin password : (.+)/);
  if (match) {
    adminPassword = match[1].trim();
  } else {
    // No generated password in logs (DB already initialised); use the known test password
    adminPassword = KNOWN_PASSWORD;
  }
});

// ─── Journey 1: Parent questionnaire ───────────────────────────────────────
test.describe('Parent questionnaire flow', () => {
  test('parent can open form, enter name, answer questions, and finalise', async ({ page, request }) => {
    test.setTimeout(120000);
    await page.goto(`/c/form/?groupToken=${GROUP_TOKEN_YEAR1}`);

    // Wait for Alpine to hydrate the form
    await page.waitForSelector('input[x-model="profile.name"]', { timeout: 15000 });

    // Enter child's name
    await page.fill('input[x-model="profile.name"]', 'E2E Test Child');
    await page.waitForTimeout(1500); // debounced save

    // Move to first question using the forward chevron button
    const nextBtn = page.locator('button:has(i.fa-chevron-right)');
    await nextBtn.click();
    await page.waitForTimeout(500);

    // Answer all questions: for each visible question, click first unanswered option
    for (let q = 0; q < 100; q++) {
      // Check if we're on the finalise screen
      const finaliseVisible = await page.locator('button:has-text("Finalise")').isVisible({ timeout: 300 }).catch(() => false);
      if (finaliseVisible) break;

      // Find answer buttons in the visible box that are NOT already selected (no is-primary)
      const unselected = page.locator('.box:visible .buttons .button.is-rounded:not(.is-primary)');
      const selectedCount = await page.locator('.box:visible .buttons .button.is-rounded.is-primary').count();
      const unselectedCount = await unselected.count();

      if (unselectedCount > 0 && selectedCount === 0) {
        // No answer selected yet — click the first option
        await unselected.first().click();
        await page.waitForTimeout(800); // wait for auto-advance
      } else {
        // Already answered or no buttons — advance manually
        await nextBtn.click();
        await page.waitForTimeout(400);
      }
    }

    // Make sure we're on the finalise screen
    let finaliseVisible = await page.locator('button:has-text("Finalise")').isVisible({ timeout: 500 }).catch(() => false);
    while (!finaliseVisible) {
      if (await nextBtn.isEnabled()) {
        await nextBtn.click();
        await page.waitForTimeout(300);
        finaliseVisible = await page.locator('button:has-text("Finalise")').isVisible({ timeout: 500 }).catch(() => false);
      } else {
        break;
      }
    }

    // Click Finalise
    const finaliseBtn = page.locator('button:has-text("Finalise")');
    await expect(finaliseBtn).toBeVisible({ timeout: 10000 });
    await finaliseBtn.click();
    await page.waitForTimeout(2000);

    // Verify via API that the profile was completed
    const token = await getAuthToken(request);
    const resp = await request.get('/api/groups/Year 1 (2024)', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resp.ok()).toBeTruthy();
    const group = await resp.json();
    const testProfile = group.profiles.find((p) => p.name === 'E2E Test Child');
    expect(testProfile).toBeTruthy();
  });
});

// ─── Journey 2: Teacher dashboard navigation ──────────────────────────────
test.describe('Teacher dashboard flow', () => {
  test('teacher can view the dashboard with groups', async ({ page, request }) => {
    const token = await getAuthToken(request);
    await injectToken(page, token);

    await page.goto('/c/');
    await page.waitForTimeout(3000);

    const body = await page.textContent('body');
    expect(body).toContain('Year 1');
    expect(body).toContain('Year 3');
  });

  test('teacher can view a group detail page', async ({ page, request }) => {
    const token = await getAuthToken(request);
    await injectToken(page, token);

    await page.goto('/c/group/?name=Year 1 (2024)');
    await page.waitForTimeout(3000);

    const body = await page.textContent('body');
    expect(body).toContain('Year 1');
  });

  test('teacher can view a completed profile', async ({ page, request }) => {
    const token = await getAuthToken(request);
    await injectToken(page, token);

    await page.goto('/c/profile/?id=12345680');
    await page.waitForTimeout(3000);

    const body = await page.textContent('body');
    expect(body).toContain('Another Name Again');
  });
});

// ─── Journey 3: Group CRUD via API ─────────────────────────────────────────
test.describe('Group management', () => {
  test('teacher can create and delete a group via API', async ({ request }) => {
    const token = await getAuthToken(request);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Create
    const createResp = await request.post('/api/groups', {
      headers,
      data: { name: 'E2E Test Group', displayAs: 'E2E Test', profilerTypeName: 'KS1 Assessment' },
    });
    expect(createResp.ok()).toBeTruthy();
    const created = await createResp.json();
    expect(created.name).toBe('E2E Test Group');

    // Verify in list
    const list1 = await (await request.get('/api/groups', { headers })).json();
    expect(list1.some((g) => g.name === 'E2E Test Group')).toBeTruthy();

    // Delete
    const delResp = await request.delete('/api/groups/E2E Test Group', { headers });
    expect(delResp.status()).toBeLessThan(300);

    // Verify gone
    const list2 = await (await request.get('/api/groups', { headers })).json();
    expect(list2.some((g) => g.name === 'E2E Test Group')).toBeFalsy();
  });
});

// ─── Journey 4: API health and auth ────────────────────────────────────────
test.describe('API health and auth', () => {
  test('API root responds', async ({ request }) => {
    const resp = await request.get('/api/');
    expect(resp.ok()).toBeTruthy();
    expect((await resp.json()).message).toContain('Brainwaves');
  });

  test('unauthenticated requests to protected routes return 401', async ({ request }) => {
    expect((await request.get('/api/groups')).status()).toBe(401);
  });

  test('login with wrong credentials fails', async ({ request }) => {
    const resp = await request.post('/auth/jwt/login', {
      form: { username: 'wrong@email.com', password: 'wrong' },
    });
    expect(resp.ok()).toBeFalsy();
  });

  test('profile token flow works end-to-end', async ({ request }) => {
    // Create profile
    const createResp = await request.post('/api/profile', {
      headers: { 'Content-Type': 'application/json' },
      data: { groupToken: GROUP_TOKEN_YEAR3 },
    });
    expect(createResp.ok()).toBeTruthy();
    const profile = await createResp.json();
    expect(profile.id).toBeTruthy();
    expect(profile.profileToken).toBeTruthy();

    // Fetch profile with token
    const getResp = await request.get(`/api/profile/${profile.id}?profileToken=${profile.profileToken}`);
    expect(getResp.ok()).toBeTruthy();

    // Fetch with wrong token should fail
    const badResp = await request.get(`/api/profile/${profile.id}?profileToken=invalid`);
    expect(badResp.ok()).toBeFalsy();
  });
});
