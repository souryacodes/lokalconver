// A small in-memory stand-in for Cache Storage, for Node tests.
// Only what LokalConver uses: open, keys, has, delete; and on a cache:
// put, match, keys, delete, addAll.

const urlOf = (input) => (typeof input === 'string' ? input : input.url);

export class FakeCache {
  constructor(fetchFn) {
    this.entries = new Map(); // url -> Response
    this.fetchFn = fetchFn;
  }
  async put(request, response) {
    this.entries.set(urlOf(request), response);
  }
  async match(request, options = {}) {
    let url = urlOf(request);
    if (options.ignoreSearch) {
      const bare = new URL(url);
      bare.search = '';
      url = bare.href;
      for (const [key, value] of this.entries) {
        const k = new URL(key);
        k.search = '';
        if (k.href === url) return value.clone();
      }
      return undefined;
    }
    const found = this.entries.get(url);
    return found ? found.clone() : undefined;
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(request) {
    return this.entries.delete(urlOf(request));
  }
  async addAll(requests) {
    const responses = [];
    for (const request of requests) {
      const response = await this.fetchFn(request.url, { cache: 'reload' });
      if (!response.ok) throw new TypeError('addAll failed: ' + request.url);
      responses.push([request.url, response]);
    }
    for (const [url, response] of responses) this.entries.set(url, response);
  }
}

export class FakeCacheStorage {
  constructor(fetchFn = async () => new Response('', { status: 404 })) {
    this.fetchFn = fetchFn;
    this.stores = new Map();
  }
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache(this.fetchFn));
    return this.stores.get(name);
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async has(name) {
    return this.stores.has(name);
  }
  async delete(name) {
    return this.stores.delete(name);
  }
}
