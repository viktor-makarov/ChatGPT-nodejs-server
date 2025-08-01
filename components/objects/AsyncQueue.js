
class AsyncQueue {
  constructor({ delayMs = 0 } = {}) {
    this._delayMs = delayMs;
    this._tasks   = [];
    this._running = false;
    this._closed  = false;
    this._onEmptyResolver = null;
  }

  add(task) {
    if (this._closed) throw new Error('Queue is closed');
    return new Promise((resolve, reject) => {
      this._tasks.push(async () => {
        try   { resolve(await task()); }
        catch (e){ reject(e); }
      });
      this._start();          // запускаем обработчик, если он остановлен
    });
  }

  async close() {
    this._closed = true;
    if (this._running || this._tasks.length)
      await new Promise(res => (this._onEmptyResolver = res));
  }

  /* ---------- private ---------- */
  async _start() {
    if (this._running) return;
    this._running = true;
    while (this._tasks.length) {
      await this._tasks.shift()();
      if (this._delayMs) await new Promise(r => setTimeout(r, this._delayMs));
    }
    this._running = false;
    if (this._closed && this._onEmptyResolver) this._onEmptyResolver();
  }
};

module.exports = AsyncQueue;
