import { test, expect } from './fixtures'

test('setup wizard: appears in a fresh context, completes and pre-fills the login', async ({ page }) => {
  // The final step really connects, so the connect target decides what is shown
  // next. A `?proxyPort=` with no listener (1) makes that attempt ALWAYS fail
  // and also guarantees that a fake-mode spec never points at the real proxy
  // (8787).
  await page.goto('/?proxyPort=1')
  const wizard = page.getByTestId('setup-wizard')
  await expect(wizard).toBeVisible({ timeout: 10_000 })

  const next = page.getByTestId('setup-next')
  await next.click()
  await page.getByTestId('setup-username').fill('e2eplayer')
  await next.click()
  await expect(page.getByTestId('setup-preset-official')).toBeVisible()
  await next.click()
  await expect(page.getByTestId('settings-layout-arena')).toBeVisible()
  await next.click()
  await expect(page.getByTestId('settings-sound-card')).toBeVisible()
  await next.click()
  await expect(page.getByTestId('setup-counter')).toContainText('6')
  // the final step ('done') shows "Entrar" (setup-enter); there is no setup-next
  await expect(page.getByTestId('setup-enter')).toBeVisible()
  await page.getByTestId('setup-enter').click()
  await expect(wizard).toBeHidden({ timeout: 5_000 })
  // Pressing Enter really connects the wizard, so the app goes through the
  // "Conectando al servidor XMage…" splash and the login form is NOT in the
  // DOM. The port above has no listener, but Gateway.connect() does not reject
  // on the socket error: it waits for its own 5 s poll
  // (src/net/Gateway.ts, waitOpen(5000)) and only then does runConnect() leave
  // phase in 'idle' and the login remount with the wizard's values (~5.1 s
  // measured).
  // El presupuesto por defecto de expect() (5 s) corría a la par de ese
  // temporizador y lo perdía por milisegundos: "element(s) not found".
  await expect(page.getByLabel(/Nombre de usuario|Usuario|Username/i)).toHaveValue('e2eplayer', { timeout: 15_000 })
})

test('setup wizard: omitir deja el login intacto', async ({ page }) => {
  await page.goto('/')
  const wizard = page.getByTestId('setup-wizard')
  await expect(wizard).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('setup-skip').click()
  await expect(wizard).toBeHidden({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: /Conectar|Connect/i })).toBeVisible()
})
