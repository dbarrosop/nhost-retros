// Cloudflare serves existing assets and SPA navigations before this fallback.
// Missing scripts, styles, and other non-navigation requests must not receive HTML.
export default {
  fetch() {
    return new Response("Not Found", { status: 404 });
  },
};
