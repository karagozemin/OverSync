/** An unset value uses the deployment's same-origin API proxy. */
export function validateCoordinatorUrl(value: string | undefined, isBuild: boolean): void {
  if (!isBuild || !value) return;

  let protocol: string | undefined;
  try {
    protocol = new URL(value).protocol;
  } catch {
    // Report the same configuration error for malformed URLs.
  }
  if (protocol !== 'https:' || !/^https:\/\//i.test(value.trim())) {
    throw new Error('VITE_API_BASE_URL must be an absolute HTTPS URL for frontend builds.');
  }
}
