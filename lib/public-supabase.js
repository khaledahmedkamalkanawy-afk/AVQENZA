const SUPABASE_URL = "https://wltukexudzoeamhddeqe.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_eVvcdqlXBwxiKX5qxm6P3Q_qV2z4oKN";

// This is the same public publishable key already used by the browser app.
// Never place a Supabase secret/service-role key in this file.
async function queryListings(params) {
  const url = new URL(SUPABASE_URL + "/rest/v1/listings");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error("Supabase listing request failed (" + response.status + "): " + detail.slice(0, 300));
  }
  return response.json();
}

async function fetchApprovedListing(id) {
  const rows = await queryListings({
    select: "id,title,description,price,city,category,image_url,image_urls,condition,status,created_at,is_urgent",
    id: "eq." + id,
    status: "eq.approved",
    limit: "1"
  });
  return rows[0] || null;
}

async function fetchApprovedListingIndex() {
  return queryListings({
    select: "id,created_at",
    status: "eq.approved",
    order: "created_at.desc",
    limit: "1000"
  });
}

module.exports = { fetchApprovedListing, fetchApprovedListingIndex };
