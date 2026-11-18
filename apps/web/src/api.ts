export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      "X-Knockout-Client": "web",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json();
  if (res.status === 401 && !path.startsWith("/auth/"))
    window.dispatchEvent(new Event("knockout:sessionexpired"));
  if (!res.ok)
    throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}
