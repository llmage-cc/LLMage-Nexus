/**
 * Build-time flag that locks a deployment to its own XMage server.
 *
 * A hosted deployment that must not offer other people's servers (official
 * beta / XDHS / arbitrary hosts) builds with this flag ON: the first-run setup
 * wizard drops its server-picker step, the login screen drops its server-target
 * preset control, and any `?server=` deep-link / saved-conn override is ignored
 * so the connect always uses the deployment's baked target.
 *
 *   VITE_LOCK_DEPLOYMENT unset (or anything but a truthy value)
 *       => OFF (default): today's behavior, nothing locked. A self-hoster who
 *          builds the app can still point it at their own server.
 *   VITE_LOCK_DEPLOYMENT '1' / 'true'
 *       => ON: the deployment is locked to its own server.
 *
 * Generic on purpose (no branding / fork assumptions) so it can be peeled off.
 * Read at call time rather than at module load so a vitest run can
 * `vi.stubEnv('VITE_LOCK_DEPLOYMENT', '1')` and exercise both states.
 */
export function isDeploymentLocked(): boolean {
  const flag = (import.meta.env.VITE_LOCK_DEPLOYMENT as string | undefined)?.trim().toLowerCase()
  return flag === '1' || flag === 'true'
}
