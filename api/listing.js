const { fetchApprovedListing } = require("../lib/public-supabase");

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
  });
}

function safeImage(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch (_) {
    return "";
  }
}

function sendError(res, status, message) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.end("<!doctype html><html lang=\"ar\" dir=\"rtl\"><meta charset=\"utf-8\"><title>الإعلان غير متاح | AVQENZA</title><body><h1>" + escapeHtml(message) + "</h1><p><a href=\"/\">العودة إلى AVQENZA</a></p></body></html>");
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return sendError(res, 405, "طريقة الطلب غير مدعومة");
  }

  const id = String((req.query && req.query.id) || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return sendError(res, 404, "الإعلان غير متاح");
  }

  try {
    const listing = await fetchApprovedListing(id);
    if (!listing) return sendError(res, 404, "الإعلان غير متاح أو لم يعد منشورًا");

    const title = String(listing.title || "إعلان على AVQENZA").slice(0, 180);
    const descriptionText = String(listing.description || "شاهد تفاصيل الإعلان وتواصل مباشرة مع البائع على AVQENZA.")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
    const description = descriptionText || "شاهد تفاصيل الإعلان وتواصل مباشرة مع البائع على AVQENZA.";
    const canonical = "https://avqenza.vercel.app/listing/" + encodeURIComponent(listing.id);
    const images = Array.isArray(listing.image_urls) && listing.image_urls.length
      ? listing.image_urls.map(safeImage).filter(Boolean)
      : [safeImage(listing.image_url)].filter(Boolean);
    const image = images[0] || "";
    const price = Number(listing.price) > 0 ? Number(listing.price) : null;
    const priceText = price ? price.toLocaleString("ar-EG") + " جنيه" : "السعر عند التواصل";
    const schema = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: title,
      description: description,
      image: images,
      category: String(listing.category || ""),
      offers: {
        "@type": "Offer",
        url: canonical,
        priceCurrency: "EGP",
        availability: "https://schema.org/InStock"
      }
    };
    if (price !== null) schema.offers.price = price;
    const jsonLd = JSON.stringify(schema).replace(/</g, "\\u003c");
    const page = [
      "<!doctype html>",
      "<html lang=\"ar\" dir=\"rtl\"><head>",
      "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
      "<title>" + escapeHtml(title) + " | AVQENZA</title>",
      "<meta name=\"description\" content=\"" + escapeHtml(description) + "\">",
      "<link rel=\"canonical\" href=\"" + escapeHtml(canonical) + "\">",
      "<meta name=\"robots\" content=\"index,follow,max-image-preview:large\">",
      "<meta property=\"og:type\" content=\"product\"><meta property=\"og:site_name\" content=\"AVQENZA\">",
      "<meta property=\"og:title\" content=\"" + escapeHtml(title) + " | AVQENZA\">",
      "<meta property=\"og:description\" content=\"" + escapeHtml(description) + "\">",
      "<meta property=\"og:url\" content=\"" + escapeHtml(canonical) + "\">",
      (image ? "<meta property=\"og:image\" content=\"" + escapeHtml(image) + "\">" : ""),
      "<meta name=\"twitter:card\" content=\"" + (image ? "summary_large_image" : "summary") + "\">",
      "<meta name=\"twitter:title\" content=\"" + escapeHtml(title) + " | AVQENZA\">",
      "<meta name=\"twitter:description\" content=\"" + escapeHtml(description) + "\">",
      (image ? "<meta name=\"twitter:image\" content=\"" + escapeHtml(image) + "\">" : ""),
      "<script type=\"application/ld+json\">" + jsonLd + "</script>",
      "<style>body{font-family:Arial,Tahoma,sans-serif;max-width:850px;margin:24px auto;padding:0 16px;color:#172033;line-height:1.8;background:#f7f8fb}.card{background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:20px}.hero{width:100%;max-height:480px;object-fit:contain;background:#f1f3f6;border-radius:12px}.price{font-size:24px;font-weight:800;color:#087f5b}.meta{color:#64748b}.button{display:inline-block;margin-top:18px;padding:12px 20px;background:#101827;color:#fff;text-decoration:none;border-radius:10px;font-weight:700}h1{font-size:25px;line-height:1.5}</style>",
      "</head><body><main class=\"card\">",
      (image ? "<img class=\"hero\" src=\"" + escapeHtml(image) + "\" alt=\"" + escapeHtml(title) + "\">" : ""),
      "<p class=\"meta\">AVQENZA MARKETPLACE · " + escapeHtml(listing.category || "إعلان") + " · " + escapeHtml(listing.city || "مصر") + "</p>",
      "<h1>" + escapeHtml(title) + "</h1>",
      "<p class=\"price\">" + escapeHtml(priceText) + "</p>",
      "<p>" + escapeHtml(description) + "</p>",
      "<p class=\"meta\">حالة المنتج: " + escapeHtml(listing.condition === "new" ? "جديد" : listing.condition === "used" ? "مستعمل" : "غير محدد") + "</p>",
      "<a class=\"button\" href=\"/?listing=" + encodeURIComponent(listing.id) + "\">عرض الإعلان والتواصل مع البائع</a>",
      "<p class=\"meta\">إعلان منشور على AVQENZA — سوق البيع والشراء في مصر</p>",
      "</main></body></html>"
    ].join("");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "HEAD") return res.end();
    return res.end(page);
  } catch (error) {
    console.error("SEO listing page error:", error);
    return sendError(res, 503, "تعذر تحميل الإعلان حاليًا، حاول مرة أخرى لاحقًا");
  }
};
