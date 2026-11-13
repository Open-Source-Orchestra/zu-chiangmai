export default {
  async fetch(request, env) {
    const requestUrl = typeof request.url === 'function' ? request.url() : request.url;
    const url = new URL(requestUrl);
    if (url.hostname === 'www.zuchiangmai.app' || url.protocol === 'http:') {
      url.hostname = 'zuchiangmai.app';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  }
};
