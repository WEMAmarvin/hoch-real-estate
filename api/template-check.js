export default function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.status(200).json({
    status: "OK",
    template: "HOCH_EXPOSE_V5_DEPLOY_CHECK",
    timestamp: "2026-05-13",
    message: "Wenn du das siehst, ist die neue ZIP wirklich deployed."
  });
}
