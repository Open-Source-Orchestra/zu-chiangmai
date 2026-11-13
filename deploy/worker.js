export default {
  async fetch(request, env) {
    const url = new URL(request.url());
    if (url.hostname === 'www.zuchiangmai.app' || url.protocol === 'http:') {
      url.hostname = 'zuchiangmai.app';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  }
};
