/**
 * Proxies Make.com scenario runs so MAKE_API_TOKEN stays server-side (Vercel env).
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const token = process.env.MAKE_API_TOKEN;
  if (!token) {
    res.status(500).json({ error: "MAKE_API_TOKEN not configured" });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const { scenario_id, data } = body || {};
  if (scenario_id == null || typeof data !== "object" || data === null) {
    res.status(400).json({ error: "scenario_id and data object are required" });
    return;
  }

  const makeResponse = await fetch(
    `https://us2.make.com/api/v2/scenarios/${scenario_id}/run`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify({
        data,
        responsive: true,
      }),
    }
  );

  const text = await makeResponse.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    result = { raw: text };
  }

  if (!makeResponse.ok) {
    res.status(makeResponse.status).json(result);
    return;
  }

  res.status(200).json(result);
}
