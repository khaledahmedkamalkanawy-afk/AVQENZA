const { fetchApprovedListingIndex } = require("../lib/public-supabase");

function xmlEscape(value) {
  return String(value == null ? "" : value).replace(/[<>&'"]/g, function (char) {
    return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[char];
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.statusCode = 405;
    return res.end();
  }
  try {
    const listings = await fetchApprovedListingIndex();
    const urls = [
      "https://avqenza.vercel.app/",
      "https://avqenza.vercel.app/about.html",
      "https://avqenza.vercel.app/contact.html",
      "https://avqenza.vercel.app/privacy.html",
      "https://avqenza.vercel.app/terms.html"
    ];
    const entries = urls.map(function (url) {
      return "<url><loc>" + xmlEscape(url) + "</loc></url>";
    });
    listings.forEach(function (listing) {
      if (!listing.id) return;
      const url = "https://avqenza.vercel.app/listing/" + encodeURIComponent(listing.id);
      const lastmod = listing.created_at ? "<lastmod>" + xmlEscape(new Date(listing.created_at).toISOString()) + "</lastmod>" : "";
      entries.push("<url><loc>" + xmlEscape(url) + "</loc>" + lastmod + "</url>");
    });
    const xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">" + entries.join("") + "</urlset>";
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "HEAD") return res.end();
    return res.end(xml);
  } catch (error) {
    console.error("Dynamic sitemap error:", error);
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Sitemap temporarily unavailable");
  }
};
